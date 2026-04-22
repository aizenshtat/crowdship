import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  API_ROUTE_DEFINITIONS,
  CONTRIBUTION_STATES,
  SPEC_APPROVED_CONTRIBUTION_STATE,
  SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE,
  getProjectSeedRecord,
} from '../src/shared/contracts.js';
import {
  createContributionDetailHandler,
  createContributionHandler,
  createContributionMessageHandler,
  createGitHubAppCallbackHandler,
  createGitHubAppSetupHandler,
  createGitHubWebhookHandler,
  createProjectGitHubInstallHandler,
  createProjectGitHubConnectionHandler,
  createContributionProgressHandler,
  createRouteHandlers,
  createSpecApprovalHandler,
} from '../src/server/routes.js';
import {
  createConfiguredContributionPersistenceAdapter,
  createInMemoryContributionPersistenceAdapter,
} from '../src/server/persistence.js';
import { createApiServer } from '../src/server/http.js';
import { SCHEMA_TABLE_NAMES } from '../src/server/schema.js';

function generatePrivateKeyPem() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {
      format: 'pem',
      type: 'pkcs8',
    },
    publicKeyEncoding: {
      format: 'pem',
      type: 'spki',
    },
  }).privateKey;
}

function requestJson({ port, method, path, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? '' : JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...(payload
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];

        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode,
            body: raw ? JSON.parse(raw) : null,
            headers: res.headers,
          });
        });
      },
    );

    req.on('error', reject);

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}

function requestBinary({ port, method, path, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          'content-length': body.length,
          ...headers,
        },
      },
      (res) => {
        const chunks = [];

        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode,
            body: raw ? JSON.parse(raw) : null,
            headers: res.headers,
          });
        });
      },
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseEventStreamEvent(rawEvent) {
  const normalized = rawEvent.replace(/\r\n/g, '\n').trim();

  if (!normalized || normalized.startsWith(':') || normalized.startsWith('retry:')) {
    return null;
  }

  let event = 'message';
  let eventSpecified = false;
  let id = null;
  const dataLines = [];

  normalized.split('\n').forEach((line) => {
    if (!line || line.startsWith(':')) {
      return;
    }
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
      eventSpecified = true;
      return;
    }
    if (line.startsWith('id:')) {
      id = line.slice('id:'.length).trim();
      return;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  });

  if (!eventSpecified && !id && !dataLines.length) {
    return null;
  }

  return {
    event,
    id,
    data: dataLines.join('\n'),
  };
}

function openEventStream({ port, path, headers = {} }) {
  return new Promise((resolve, reject) => {
    const queuedEvents = [];
    const pending = [];
    let response = null;
    let buffer = '';
    let closed = false;

    const settlePending = (error) => {
      while (pending.length) {
        const waiter = pending.shift();
        if (error) {
          waiter.reject(error);
        } else {
          waiter.resolve(null);
        }
      }
    };

    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: 'GET',
        path,
        headers: {
          accept: 'text/event-stream',
          ...headers,
        },
      },
      (res) => {
        response = res;
        response.setEncoding('utf8');

        response.on('data', (chunk) => {
          buffer += chunk.replace(/\r\n/g, '\n');

          while (buffer.includes('\n\n')) {
            const boundary = buffer.indexOf('\n\n');
            const rawEvent = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);

            const parsed = parseEventStreamEvent(rawEvent);

            if (!parsed) {
              continue;
            }

            if (pending.length) {
              pending.shift().resolve(parsed);
            } else {
              queuedEvents.push(parsed);
            }
          }
        });

        response.on('close', () => {
          closed = true;
          settlePending();
        });

        resolve({
          get status() {
            return response ? response.statusCode : null;
          },
          get headers() {
            return response ? response.headers : {};
          },
          nextEvent(timeoutMs = 4000) {
            if (queuedEvents.length) {
              return Promise.resolve(queuedEvents.shift());
            }

            if (closed) {
              return Promise.resolve(null);
            }

            return new Promise((resolveEvent, rejectEvent) => {
              const timeout = setTimeout(() => {
                const index = pending.findIndex((entry) => entry.resolve === resolveWrapped);
                if (index >= 0) {
                  pending.splice(index, 1);
                }
                rejectEvent(new Error(`Timed out waiting for SSE event from ${path}.`));
              }, timeoutMs);

              const resolveWrapped = (value) => {
                clearTimeout(timeout);
                resolveEvent(value);
              };
              const rejectWrapped = (error) => {
                clearTimeout(timeout);
                rejectEvent(error);
              };

              pending.push({
                resolve: resolveWrapped,
                reject: rejectWrapped,
              });
            });
          },
          close() {
            closed = true;
            settlePending();
            if (response && !response.destroyed) {
              response.destroy();
            }
            req.destroy();
          },
        });
      },
    );

    req.on('error', (error) => {
      closed = true;
      settlePending(error);
      reject(error);
    });

    req.end();
  });
}

function buildCreatePayload() {
  return {
    project: 'example',
    environment: 'production',
    type: 'feature_request',
    title: 'Add anomaly replay for signal drops',
    body: 'I need to replay the selected signal drop anomaly from the mission screen.',
    hostOrigin: 'https://example.aizenshtat.eu',
    route: '/mission',
    url: 'https://example.aizenshtat.eu/mission',
    appVersion: '2026.04.18',
    user: {
      id: 'customer-123',
      email: 'customer@example.com',
      role: 'customer',
    },
    context: {
      selectedObjectType: 'anomaly',
      selectedObjectId: 'signal-drop-17',
      activeFilters: {
        craft: 'all',
        window: 'last-30',
      },
    },
    client: {
      timezone: 'Europe/Vienna',
      locale: 'en-US',
    },
    attachments: [
      {
        filename: 'signal-drop-17.csv',
        contentType: 'text/csv',
        kind: 'text/csv',
        sizeBytes: 1842,
      },
    ],
  };
}

function createStubSpecService() {
  return {
    async startConversation({ contribution }) {
      return {
        action: 'ask_user',
        assistantMessage: `Before I draft the spec for ${contribution.title}, I need two quick details.`,
        questions: [
          {
            id: 'desired-outcome',
            question: 'What should the operator be able to do immediately after selecting the anomaly?',
            why: 'This defines the user-facing outcome.',
            suggestedAnswerFormat: 'One short sentence',
            choices: [
              { id: 'launch-replay', label: 'Launch replay from the selected anomaly' },
              { id: 'inspect-pressure', label: 'Inspect cabin pressure without leaving mission view' },
            ],
          },
          {
            id: 'stay-unchanged',
            question: 'What should stay unchanged on the mission screen while replay is added?',
            why: 'This narrows non-goals.',
            suggestedAnswerFormat: 'Short bullet list',
          },
        ],
        metadata: {
          provider: 'stub',
          model: 'gpt-5.4',
        },
      };
    },

    async continueConversation() {
      return {
        action: 'draft_spec',
        assistantMessage: 'I drafted the first approval-ready scope.',
        goal: 'Let operators replay the selected signal drop from the mission screen.',
        userProblem:
          'Operators can spot a signal drop but cannot inspect the telemetry leading into it without leaving the mission workflow.',
        acceptanceCriteria: [
          'The operator can launch replay from /mission for the selected anomaly.',
          'Replay keeps the selected anomaly and active filters in context.',
          'Replay starts quickly and keeps recovery on the same mission surface.',
        ],
        nonGoals: [
          'Do not redesign unrelated mission-control surfaces.',
          'Do not rebuild the broader telemetry pipeline.',
        ],
        metadata: {
          provider: 'stub',
          model: 'gpt-5.4',
        },
      };
    },

    async finalizeConversation() {
      return {
        action: 'draft_spec',
        assistantMessage: 'I drafted the first approval-ready scope.',
        goal: 'Let operators replay the selected signal drop from the mission screen.',
        userProblem:
          'Operators can spot a signal drop but cannot inspect the telemetry leading into it without leaving the mission workflow.',
        acceptanceCriteria: [
          'The operator can launch replay from /mission for the selected anomaly.',
          'The replay keeps the mission layout and active filters visible.',
          'The replay includes the lead-up to the selected signal drop.',
        ],
        nonGoals: [
          'Redesigning unrelated mission-control flows.',
          'Changing authentication or permissions.',
        ],
        metadata: {
          provider: 'stub',
          model: 'gpt-5.4',
        },
      };
    },

    async refineSpec({ refinementNote }) {
      return {
        assistantMessage: 'I updated the scope to keep controls on the same mission surface.',
        goal: 'Let operators replay the selected signal drop without leaving the mission screen.',
        userProblem: `Operators need replay without losing context. Latest refinement: ${refinementNote}`,
        acceptanceCriteria: [
          'Replay launches from /mission for the selected anomaly.',
          'Replay controls remain visible on the same mission surface.',
          'The selected anomaly and active filters remain in context during replay.',
        ],
        nonGoals: [
          'Do not redesign unrelated mission-control surfaces.',
          'Do not rebuild the broader telemetry pipeline.',
        ],
        metadata: {
          provider: 'stub',
          model: 'gpt-5.4',
        },
      };
    },
  };
}

async function setProjectCiStatusToken(database, token = 'test-ci-status-token') {
  const project = await database.getProject('example');
  assert.ok(project);

  await database.upsertProject({
    ...structuredClone(project),
    runtimeConfig: {
      ...structuredClone(project.runtimeConfig ?? {}),
      ciStatusToken: token,
    },
  });

  return token;
}

test('shared contribution states preserve the lifecycle order', () => {
  assert.deepEqual(CONTRIBUTION_STATES, [
    'draft_chat',
    'spec_pending_approval',
    'spec_approved',
    'agent_queued',
    'agent_running',
    'implementation_failed',
    'pr_opened',
    'preview_deploying',
    'preview_failed',
    'preview_ready',
    'requester_review',
    'revision_requested',
    'ready_for_voting',
    'voting_open',
    'core_team_flagged',
    'core_review',
    'merged',
    'production_deploying',
    'completed',
    'rejected',
  ]);
});

test('example seed project includes public config and runtime config for the hosted reference app', () => {
  const project = getProjectSeedRecord('example');

  assert.ok(project);
  assert.equal(project.slug, 'example');
  assert.equal(project.publicConfig.project, 'example');
  assert.ok(project.publicConfig.allowedOrigins.includes('https://example.aizenshtat.eu'));
  assert.ok(project.publicConfig.allowedOrigins.includes('http://localhost:5173'));
  assert.equal(project.runtimeConfig.repositoryFullName, 'aizenshtat/example');
  assert.equal(project.runtimeConfig.defaultBranch, 'main');
  assert.match(project.runtimeConfig.previewUrlPattern, /\{contributionId\}/);
});

test('api route structure includes the required public endpoints', () => {
  assert.deepEqual(
    API_ROUTE_DEFINITIONS.map(({ method, path }) => `${method} ${path}`),
    [
      'GET /api/github/setup',
      'GET /api/github/callback',
      'POST /api/github/webhooks',
      'GET /api/v1/health',
      'GET /api/v1/demo-video',
      'POST /api/v1/demo-video/upload',
      'GET /api/v1/projects/:project',
      'PUT /api/v1/projects/:project',
      'GET /api/v1/projects/:project/github-connection',
      'GET /api/v1/projects/:project/github-install',
      'GET /api/v1/projects/:project/public-config',
      'GET /api/v1/contributions',
      'POST /api/v1/contributions',
      'GET /api/v1/contributions/:id',
      'POST /api/v1/contributions/:id/attachments',
      'POST /api/v1/contributions/:id/messages',
      'POST /api/v1/contributions/:id/spec-approval',
      'GET /api/v1/contributions/:id/progress',
      'GET /api/v1/contributions/:id/stream',
      'POST /api/v1/contributions/:id/queue-implementation',
      'POST /api/v1/contributions/:id/pull-requests',
      'POST /api/v1/contributions/:id/preview-deployments',
      'GET /api/v1/contributions/:id/preview-evidence',
      'POST /api/v1/contributions/:id/ci-status',
      'POST /api/v1/contributions/:id/preview-review',
      'POST /api/v1/contributions/:id/open-voting',
      'POST /api/v1/contributions/:id/request-clarification',
      'POST /api/v1/contributions/:id/flag-core-review',
      'POST /api/v1/contributions/:id/start-core-review',
      'POST /api/v1/contributions/:id/votes',
      'POST /api/v1/contributions/:id/comments',
      'POST /api/v1/contributions/:id/comments/:commentId/disposition',
      'POST /api/v1/contributions/:id/mark-merged',
      'POST /api/v1/contributions/:id/start-production-deploy',
      'POST /api/v1/contributions/:id/complete',
      'POST /api/v1/contributions/:id/archive',
    ],
  );
});

test('github app setup route redirects to settings with install context', async () => {
  const getGitHubSetup = createGitHubAppSetupHandler();
  const response = await getGitHubSetup({
    query: {
      installation_id: '91',
      setup_action: 'install',
    },
  });

  assert.equal(response.status, 303);
  assert.equal(response.responseMode, 'redirect');
  assert.equal(
    response.location,
    '/?section=settings&github_source=setup&github_status=complete&github_installation_id=91&github_setup_action=install',
  );
});

test('github app callback route redirects GitHub errors back into settings', async () => {
  const getGitHubCallback = createGitHubAppCallbackHandler();
  const response = await getGitHubCallback({
    query: {
      error: 'access_denied',
      error_description: 'The owner declined the authorization request.',
    },
  });

  assert.equal(response.status, 303);
  assert.equal(response.responseMode, 'redirect');
  assert.equal(
    response.location,
    '/?section=settings&github_source=callback&github_status=error&github_error=access_denied&github_error_description=The+owner+declined+the+authorization+request.',
  );
});

test('project github install route redirects through a project-scoped install entrypoint', async () => {
  const getProjectGitHubInstall = createProjectGitHubInstallHandler({
    database: createInMemoryContributionPersistenceAdapter(),
    fetchImpl: async (url) => {
      assert.equal(url, 'https://api.github.com/app');
      return new Response(
        JSON.stringify({
          slug: 'aizenshtat-crowdship',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      );
    },
  });
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  process.env.GITHUB_APP_ID = '12345';
  process.env.GITHUB_APP_PRIVATE_KEY = generatePrivateKeyPem();

  try {
    const response = await getProjectGitHubInstall({
      params: { project: 'example' },
    });

    assert.equal(response.status, 303);
    assert.equal(response.responseMode, 'redirect');
    assert.equal(
      response.location,
      'https://github.com/apps/aizenshtat-crowdship/installations/new?state=crowdship-project%3Aexample',
    );
  } finally {
    if (previousAppId == null) {
      delete process.env.GITHUB_APP_ID;
    } else {
      process.env.GITHUB_APP_ID = previousAppId;
    }

    if (previousPrivateKey == null) {
      delete process.env.GITHUB_APP_PRIVATE_KEY;
    } else {
      process.env.GITHUB_APP_PRIVATE_KEY = previousPrivateKey;
    }
  }
});

test('github app setup route preserves project context from the install state', async () => {
  const getGitHubSetup = createGitHubAppSetupHandler();
  const response = await getGitHubSetup({
    query: {
      state: 'crowdship-project:example',
      installation_id: '91',
      setup_action: 'install',
    },
  });

  assert.equal(response.status, 303);
  assert.equal(response.responseMode, 'redirect');
  assert.equal(
    response.location,
    '/?section=settings&project=example&github_source=setup&github_status=complete&github_installation_id=91&github_setup_action=install',
  );
});

test('github webhook route accepts signed non-PR deliveries and leaves sync idle', async () => {
  const payload = JSON.stringify({
    installation: {
      id: 91,
    },
  });
  const postGitHubWebhook = createGitHubWebhookHandler({
    env: {
      GITHUB_APP_WEBHOOK_SECRET: 'hook-secret',
    },
  });
  const response = await postGitHubWebhook({
    request: {
      headers: {
        'x-github-event': 'ping',
        'x-github-delivery': 'delivery-1',
        'x-hub-signature-256': `sha256=${createHmac('sha256', 'hook-secret').update(payload).digest('hex')}`,
      },
    },
    rawBody: Buffer.from(payload, 'utf8'),
    body: JSON.parse(payload),
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.webhook.status, 'accepted');
  assert.equal(response.body.webhook.event, 'ping');
  assert.equal(response.body.webhook.deliveryId, 'delivery-1');
  assert.equal(response.body.webhook.installationId, '91');
  assert.equal(response.body.webhook.sync.status, 'ignored');
  assert.equal(response.body.webhook.sync.reason, 'unsupported_event');
});

test('github webhook route syncs installation deliveries into project github connection metadata', async () => {
  const database = createInMemoryContributionPersistenceAdapter();
  const payload = JSON.stringify({
    action: 'created',
    installation: {
      id: 91,
      repository_selection: 'selected',
      account: {
        login: 'aizenshtat',
      },
    },
    repositories: [
      {
        full_name: 'aizenshtat/example',
      },
    ],
  });
  const postGitHubWebhook = createGitHubWebhookHandler({
    database,
    env: {
      GITHUB_APP_WEBHOOK_SECRET: 'hook-secret',
    },
    clock: () => new Date('2026-04-20T10:00:00Z'),
  });
  const response = await postGitHubWebhook({
    request: {
      headers: {
        'x-github-event': 'installation',
        'x-github-delivery': 'delivery-install-created',
        'x-hub-signature-256': `sha256=${createHmac('sha256', 'hook-secret').update(payload).digest('hex')}`,
      },
    },
    rawBody: Buffer.from(payload, 'utf8'),
    body: JSON.parse(payload),
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.webhook.sync.status, 'applied');
  assert.deepEqual(response.body.webhook.sync.matchedProjectSlugs, ['example']);
  assert.deepEqual(response.body.webhook.sync.updatedProjectSlugs, ['example']);
  assert.equal(response.body.webhook.sync.connectionStatus, 'connected');

  const storedProject = await database.getProject('example');
  assert.deepEqual(storedProject.runtimeConfig.githubConnection, {
    repositoryFullName: 'aizenshtat/example',
    status: 'connected',
    appSlug: null,
    appName: null,
    appUrl: null,
    ownerLogin: null,
    installationId: 91,
    accountLogin: 'aizenshtat',
    repositorySelection: 'selected',
    updatedAt: '2026-04-20T10:00:00.000Z',
  });
});

test('github webhook route clears saved install metadata when a repository is removed from an installation', async () => {
  const seedProject = getProjectSeedRecord('example');
  const database = createInMemoryContributionPersistenceAdapter({
    initialProjects: [
      {
        ...seedProject,
        runtimeConfig: {
          ...seedProject.runtimeConfig,
          githubConnection: {
            repositoryFullName: 'aizenshtat/example',
            status: 'connected',
            installationId: 91,
            accountLogin: 'aizenshtat',
            repositorySelection: 'selected',
            updatedAt: '2026-04-19T10:00:00.000Z',
          },
        },
      },
    ],
  });
  const payload = JSON.stringify({
    action: 'removed',
    installation: {
      id: 91,
      repository_selection: 'selected',
      account: {
        login: 'aizenshtat',
      },
    },
    repositories_removed: [
      {
        full_name: 'aizenshtat/example',
      },
    ],
  });
  const postGitHubWebhook = createGitHubWebhookHandler({
    database,
    env: {
      GITHUB_APP_WEBHOOK_SECRET: 'hook-secret',
    },
    clock: () => new Date('2026-04-20T11:00:00Z'),
  });
  const response = await postGitHubWebhook({
    request: {
      headers: {
        'x-github-event': 'installation_repositories',
        'x-github-delivery': 'delivery-install-removed',
        'x-hub-signature-256': `sha256=${createHmac('sha256', 'hook-secret').update(payload).digest('hex')}`,
      },
    },
    rawBody: Buffer.from(payload, 'utf8'),
    body: JSON.parse(payload),
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.webhook.sync.status, 'applied');
  assert.deepEqual(response.body.webhook.sync.matchedProjectSlugs, ['example']);
  assert.deepEqual(response.body.webhook.sync.updatedProjectSlugs, ['example']);
  assert.equal(response.body.webhook.sync.connectionStatus, 'not_installed');

  const storedProject = await database.getProject('example');
  assert.deepEqual(storedProject.runtimeConfig.githubConnection, {
    repositoryFullName: 'aizenshtat/example',
    status: 'not_installed',
    appSlug: null,
    appName: null,
    appUrl: null,
    ownerLogin: null,
    installationId: null,
    accountLogin: null,
    repositorySelection: null,
    updatedAt: '2026-04-20T11:00:00.000Z',
  });
});

test('github webhook route rejects unsigned deliveries when webhook validation is configured', async () => {
  const postGitHubWebhook = createGitHubWebhookHandler({
    env: {
      GITHUB_APP_WEBHOOK_SECRET: 'hook-secret',
    },
  });
  const response = await postGitHubWebhook({
    request: {
      headers: {
        'x-github-event': 'ping',
      },
    },
    rawBody: Buffer.from('{}', 'utf8'),
    body: {},
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'github_webhook_signature_invalid');
});

test('github webhook route syncs merged pull requests back into contribution state', async () => {
  const database = createInMemoryContributionPersistenceAdapter();
  const handlers = createRouteHandlers({
    database,
    specService: createStubSpecService(),
  });
  const created = await handlers.postContribution({
    body: buildCreatePayload(),
  });
  const contributionId = created.body.contribution.id;
  const branchName = `crowdship/${contributionId}-signal-drop-replay`;

  await handlers.postContributionMessage({
    params: { id: contributionId },
    body: {
      body: 'The replay should stay in the mission view and keep telemetry visible.',
    },
  });
  await handlers.postSpecApproval({
    params: { id: contributionId },
    body: {
      decision: 'approve',
    },
  });
  await handlers.postPullRequest({
    params: { id: contributionId },
    body: {
      repositoryFullName: 'aizenshtat/example',
      number: 42,
      url: 'https://github.com/aizenshtat/example/pull/42',
      branchName,
      status: 'open',
    },
  });

  const payload = JSON.stringify({
    action: 'closed',
    number: 42,
    repository: {
      full_name: 'aizenshtat/example',
    },
    pull_request: {
      number: 42,
      state: 'closed',
      merged: true,
      merged_at: '2099-01-01T00:00:00.000Z',
      updated_at: '2099-01-01T00:00:00.000Z',
      html_url: 'https://github.com/aizenshtat/example/pull/42',
      body: `## Crowdship Contribution\n\n- Contribution ID: \`${contributionId}\`\n`,
      head: {
        ref: branchName,
        sha: 'abc123def456',
      },
      base: {
        ref: 'main',
        repo: {
          full_name: 'aizenshtat/example',
        },
      },
      merged_by: {
        login: 'octocat',
      },
    },
  });
  const postGitHubWebhook = createGitHubWebhookHandler({
    database,
    env: {
      GITHUB_APP_WEBHOOK_SECRET: 'hook-secret',
    },
  });
  const response = await postGitHubWebhook({
    request: {
      headers: {
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-2',
        'x-hub-signature-256': `sha256=${createHmac('sha256', 'hook-secret').update(payload).digest('hex')}`,
      },
    },
    rawBody: Buffer.from(payload, 'utf8'),
    body: JSON.parse(payload),
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.webhook.sync.status, 'applied');
  assert.equal(response.body.webhook.sync.contributionId, contributionId);
  assert.equal(response.body.webhook.sync.pullRequestStatus, 'merged');

  const detail = await database.getContributionDetail(contributionId);
  const latestPullRequest = detail.pullRequests.at(-1);

  assert.equal(detail.contribution.state, 'merged');
  assert.equal(latestPullRequest.status, 'merged');
  assert.equal(latestPullRequest.headSha, 'abc123def456');
  assert.equal(detail.progressEvents.at(-1).kind, 'merged_recorded');
});

test('api server exposes demo video status and accepts authenticated binary uploads', async () => {
  const previousStorageDir = process.env.DEMO_VIDEO_STORAGE_DIR;
  const previousUploadToken = process.env.DEMO_VIDEO_UPLOAD_TOKEN;
  const storageDir = mkdtempSync(join(tmpdir(), 'crowdship-demo-video-test-'));

  process.env.DEMO_VIDEO_STORAGE_DIR = storageDir;
  process.env.DEMO_VIDEO_UPLOAD_TOKEN = 'demo-token';

  const server = createApiServer({
    database: createInMemoryContributionPersistenceAdapter(),
    specService: createStubSpecService(),
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;

    const initial = await requestJson({
      port,
      method: 'GET',
      path: '/api/v1/demo-video',
    });

    assert.equal(initial.status, 200);
    assert.equal(initial.body.hasVideo, false);
    assert.equal(initial.body.uploadEnabled, true);

    const uploaded = await requestBinary({
      port,
      method: 'POST',
      path: '/api/v1/demo-video/upload',
      body: Buffer.from('not-a-real-video-but-good-enough-for-storage'),
      headers: {
        'content-type': 'video/mp4',
        'x-demo-video-token': 'demo-token',
        'x-demo-video-filename': 'crowdship-demo.mp4',
      },
    });

    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.hasVideo, true);
    assert.equal(uploaded.body.video.filename, 'crowdship-demo.mp4');
    assert.equal(uploaded.body.video.contentType, 'video/mp4');
    assert.match(uploaded.body.videoPath, /\/demo-video\/assets\/current-.*\.mp4$/);
    assert.ok(existsSync(join(storageDir, 'public', uploaded.body.videoPath.split('/').pop())));

    const detail = await requestJson({
      port,
      method: 'GET',
      path: '/api/v1/demo-video',
    });

    assert.equal(detail.status, 200);
    assert.equal(detail.body.hasVideo, true);
    assert.equal(detail.body.video.filename, 'crowdship-demo.mp4');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

    if (previousStorageDir == null) {
      delete process.env.DEMO_VIDEO_STORAGE_DIR;
    } else {
      process.env.DEMO_VIDEO_STORAGE_DIR = previousStorageDir;
    }

    if (previousUploadToken == null) {
      delete process.env.DEMO_VIDEO_UPLOAD_TOKEN;
    } else {
      process.env.DEMO_VIDEO_UPLOAD_TOKEN = previousUploadToken;
    }
  }
});

test('api server stores uploaded attachment bytes and replaces the metadata-only storage key', async () => {
  const previousStorageDir = process.env.ATTACHMENT_STORAGE_DIR;
  const previousMaxBytes = process.env.ATTACHMENT_MAX_BYTES;
  const storageDir = mkdtempSync(join(tmpdir(), 'crowdship-attachment-test-'));
  const payload = Buffer.from('timestamp,value\n2026-04-18T12:00:00Z,17\n', 'utf8');

  process.env.ATTACHMENT_STORAGE_DIR = storageDir;
  process.env.ATTACHMENT_MAX_BYTES = '26214400';

  const server = createApiServer({
    database: createInMemoryContributionPersistenceAdapter(),
    specService: createStubSpecService(),
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;

    const created = await requestJson({
      port,
      method: 'POST',
      path: '/api/v1/contributions',
      body: {
        ...buildCreatePayload(),
        attachments: [
          {
            ...buildCreatePayload().attachments[0],
            sizeBytes: payload.length,
          },
        ],
      },
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.attachments.length, 1);

    const originalAttachment = created.body.attachments[0];
    assert.match(originalAttachment.storageKey, /^metadata-only:\/\//);

    const uploaded = await requestBinary({
      port,
      method: 'POST',
      path: `/api/v1/contributions/${created.body.contribution.id}/attachments`,
      body: payload,
      headers: {
        'content-type': 'text/csv',
        'x-crowdship-attachment-id': originalAttachment.id,
      },
    });

    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.attachment.id, originalAttachment.id);
    assert.equal(uploaded.body.attachment.contributionId, created.body.contribution.id);
    assert.doesNotMatch(uploaded.body.attachment.storageKey, /^metadata-only:\/\//);
    assert.equal(readFileSync(join(storageDir, uploaded.body.attachment.storageKey), 'utf8'), payload.toString('utf8'));

    const detail = await requestJson({
      port,
      method: 'GET',
      path: `/api/v1/contributions/${created.body.contribution.id}`,
    });

    assert.equal(detail.status, 200);
    assert.equal(detail.body.attachments[0].id, originalAttachment.id);
    assert.equal(detail.body.attachments[0].storageKey, uploaded.body.attachment.storageKey);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

    if (previousStorageDir == null) {
      delete process.env.ATTACHMENT_STORAGE_DIR;
    } else {
      process.env.ATTACHMENT_STORAGE_DIR = previousStorageDir;
    }

    if (previousMaxBytes == null) {
      delete process.env.ATTACHMENT_MAX_BYTES;
    } else {
      process.env.ATTACHMENT_MAX_BYTES = previousMaxBytes;
    }
  }
});

test('api server rejects unsupported attachment uploads and preserves the metadata-only record', async () => {
  const previousStorageDir = process.env.ATTACHMENT_STORAGE_DIR;
  const previousMaxBytes = process.env.ATTACHMENT_MAX_BYTES;
  const storageDir = mkdtempSync(join(tmpdir(), 'crowdship-attachment-reject-test-'));

  process.env.ATTACHMENT_STORAGE_DIR = storageDir;
  process.env.ATTACHMENT_MAX_BYTES = '26214400';

  const server = createApiServer({
    database: createInMemoryContributionPersistenceAdapter(),
    specService: createStubSpecService(),
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;

    const created = await requestJson({
      port,
      method: 'POST',
      path: '/api/v1/contributions',
      body: buildCreatePayload(),
    });

    assert.equal(created.status, 201);
    const originalAttachment = created.body.attachments[0];

    const rejected = await requestBinary({
      port,
      method: 'POST',
      path: `/api/v1/contributions/${created.body.contribution.id}/attachments`,
      body: Buffer.from('PK\x03\x04not-a-real-zip', 'utf8'),
      headers: {
        'content-type': 'application/zip',
        'x-crowdship-attachment-id': originalAttachment.id,
      },
    });

    assert.equal(rejected.status, 415);
    assert.equal(rejected.body.error, 'attachment_type_not_supported');

    const detail = await requestJson({
      port,
      method: 'GET',
      path: `/api/v1/contributions/${created.body.contribution.id}`,
    });

    assert.equal(detail.status, 200);
    assert.equal(detail.body.attachments[0].id, originalAttachment.id);
    assert.equal(detail.body.attachments[0].storageKey, originalAttachment.storageKey);
    assert.equal(existsSync(join(storageDir, created.body.contribution.id, originalAttachment.id)), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

    if (previousStorageDir == null) {
      delete process.env.ATTACHMENT_STORAGE_DIR;
    } else {
      process.env.ATTACHMENT_STORAGE_DIR = previousStorageDir;
    }

    if (previousMaxBytes == null) {
      delete process.env.ATTACHMENT_MAX_BYTES;
    } else {
      process.env.ATTACHMENT_MAX_BYTES = previousMaxBytes;
    }
  }
});

test('drizzle schema exposes the expected table names', () => {
  assert.deepEqual(SCHEMA_TABLE_NAMES, [
    'projects',
    'contributions',
    'attachments',
    'chat_messages',
    'spec_versions',
    'progress_events',
    'votes',
    'comments',
    'implementation_jobs',
    'pull_requests',
    'preview_deployments',
  ]);
});

test('project persistence can upsert, list, and read public config from stored records', async () => {
  const seed = getProjectSeedRecord('example');
  const persistence = createInMemoryContributionPersistenceAdapter({
    initialProjects: [],
  });

  await persistence.upsertProject({
    ...seed,
    name: 'Orbital Ops Staging',
    publicConfig: {
      ...seed.publicConfig,
      widgetScriptUrl: 'https://crowdship.test/widget.js',
      allowedOrigins: ['https://orbital.test'],
    },
    allowedOrigins: ['https://orbital.test'],
    runtimeConfig: {
      ...seed.runtimeConfig,
      repositoryFullName: 'customer/orbital-ops',
      defaultBranch: 'trunk',
    },
  });

  const projects = await persistence.listProjects();
  const project = await persistence.getProject('example');
  const publicConfig = await persistence.getProjectPublicConfig('example');

  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, 'Orbital Ops Staging');
  assert.equal(project.runtimeConfig.repositoryFullName, 'customer/orbital-ops');
  assert.equal(project.runtimeConfig.defaultBranch, 'trunk');
  assert.equal(publicConfig.widgetScriptUrl, 'https://crowdship.test/widget.js');
  assert.deepEqual(publicConfig.allowedOrigins, ['https://orbital.test']);
});

test('contribution creation does not fake success when persistence is missing', async () => {
  const createContribution = createContributionHandler();
  const response = await createContribution({
    body: buildCreatePayload(),
  });

  assert.equal(response.status, 501);
  assert.match(response.body.message, /not wired/i);
  assert.equal('id' in response.body, false);
  assert.equal('contributionId' in response.body, false);
});

test('project public config route reads the stored project record', async () => {
  const seed = getProjectSeedRecord('example');
  const database = createInMemoryContributionPersistenceAdapter({
    initialProjects: [
      {
        ...seed,
        publicConfig: {
          ...seed.publicConfig,
          widgetScriptUrl: 'https://crowdship.test/custom-widget.js',
          allowedOrigins: ['https://orbital.test'],
        },
        allowedOrigins: ['https://orbital.test'],
      },
    ],
  });
  const getProjectPublicConfig = createRouteHandlers({ database }).getProjectPublicConfig;

  const response = await getProjectPublicConfig({
    params: { project: 'example' },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.project, 'example');
  assert.equal(response.body.widgetScriptUrl, 'https://crowdship.test/custom-widget.js');
  assert.deepEqual(response.body.allowedOrigins, ['https://orbital.test']);
});

test('project route reads and updates the stored runtime config record', async () => {
  const seed = getProjectSeedRecord('example');
  const database = createInMemoryContributionPersistenceAdapter({
    initialProjects: [seed],
  });
  const { getProject, putProject } = createRouteHandlers({ database });

  const initialResponse = await getProject({
    params: { project: 'example' },
  });

  assert.equal(initialResponse.status, 200);
  assert.equal(initialResponse.body.project.slug, 'example');
  assert.equal(initialResponse.body.project.runtimeConfig.repositoryFullName, 'aizenshtat/example');
  assert.equal(initialResponse.body.project.runtimeConfig.executionMode, 'hosted_remote_clone');
  assert.equal(initialResponse.body.project.runtimeConfig.ciStatusToken, undefined);

  const updateResponse = await putProject({
    params: { project: 'example' },
    body: {
      project: {
        slug: 'example',
        name: 'Orbital Ops Flight',
        allowedOrigins: ['https://orbital.test', 'https://orbital.test'],
        publicConfig: {
          ...seed.publicConfig,
          widgetScriptUrl: 'https://crowdship.test/widget/v2.js',
        },
        runtimeConfig: {
          ...seed.runtimeConfig,
          executionMode: 'hosted',
          repositoryFullName: 'customer/orbital-ops',
          defaultBranch: 'trunk',
          previewBaseUrl: 'https://preview.orbital.test',
          ciStatusToken: 'server-side-only-token',
          autoQueueImplementation: true,
          autoOpenVoting: true,
          implementationTimeoutMinutes: 45,
          coreReviewVoteThreshold: 3,
        },
      },
    },
  });

  assert.equal(updateResponse.status, 200);
  assert.equal(updateResponse.body.project.name, 'Orbital Ops Flight');
  assert.equal(updateResponse.body.project.publicConfig.widgetScriptUrl, 'https://crowdship.test/widget/v2.js');
  assert.deepEqual(updateResponse.body.project.allowedOrigins, ['https://orbital.test']);
  assert.equal(updateResponse.body.project.runtimeConfig.repositoryFullName, 'customer/orbital-ops');
  assert.equal(updateResponse.body.project.runtimeConfig.defaultBranch, 'trunk');
  assert.equal(updateResponse.body.project.runtimeConfig.executionMode, 'hosted_remote_clone');
  assert.equal(updateResponse.body.project.runtimeConfig.previewBaseUrl, 'https://preview.orbital.test');
  assert.equal(updateResponse.body.project.runtimeConfig.ciStatusToken, undefined);
  assert.equal(updateResponse.body.project.runtimeConfig.autoQueueImplementation, true);
  assert.equal(updateResponse.body.project.runtimeConfig.autoOpenVoting, true);
  assert.equal(updateResponse.body.project.runtimeConfig.implementationTimeoutMinutes, 45);
  assert.equal(updateResponse.body.project.runtimeConfig.coreReviewVoteThreshold, 3);

  const storedProject = await database.getProject('example');
  assert.equal(storedProject.runtimeConfig.ciStatusToken, 'server-side-only-token');
});

test('project route rejects a mismatched slug in the update payload', async () => {
  const { putProject } = createRouteHandlers({
    database: createInMemoryContributionPersistenceAdapter(),
  });

  const response = await putProject({
    params: { project: 'example' },
    body: {
      project: {
        slug: 'other-project',
      },
    },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'invalid_project_payload');
  assert.match(response.body.issues[0], /slug must match/);
});

test('project github connection route reports a connected hosted install', async () => {
  const persistence = createInMemoryContributionPersistenceAdapter({
    clock: () => new Date('2026-04-20T09:15:00Z'),
  });
  const getProjectGitHubConnection = createProjectGitHubConnectionHandler({
    database: persistence,
    clock: () => new Date('2026-04-20T09:15:00Z'),
    fetchImpl: async (url) => {
      if (url === 'https://api.github.com/app') {
        return new Response(
          JSON.stringify({
            id: 55,
            slug: 'aizenshtat-crowdship',
            name: 'Aizenshtat CrowdShip',
            html_url: 'https://github.com/apps/aizenshtat-crowdship',
            owner: {
              login: 'aizenshtat',
            },
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        );
      }

      if (url === 'https://api.github.com/repos/aizenshtat/example/installation') {
        return new Response(
          JSON.stringify({
            id: 91,
            repository_selection: 'selected',
            account: {
              login: 'aizenshtat',
            },
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        );
      }

      throw new Error(`Unexpected fetch request: ${url}`);
    },
  });
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  process.env.GITHUB_APP_ID = '12345';
  process.env.GITHUB_APP_PRIVATE_KEY = generatePrivateKeyPem();

  try {
    const response = await getProjectGitHubConnection({
      params: { project: 'example' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.githubConnection.status, 'connected');
    assert.equal(response.body.githubConnection.repositoryFullName, 'aizenshtat/example');
    assert.equal(response.body.githubConnection.appSlug, 'aizenshtat-crowdship');
    assert.equal(response.body.githubConnection.installationId, 91);
    assert.equal(response.body.githubConnection.persistedStatus, 'connected');
    assert.equal(response.body.githubConnection.persistedAt, '2026-04-20T09:15:00.000Z');
    assert.equal(response.body.githubConnection.installEntryUrl, '/api/v1/projects/example/github-install');

    const storedProject = await persistence.getProject('example');
    assert.equal(storedProject.runtimeConfig.githubConnection.repositoryFullName, 'aizenshtat/example');
    assert.equal(storedProject.runtimeConfig.githubConnection.status, 'connected');
    assert.equal(storedProject.runtimeConfig.githubConnection.installationId, 91);
    assert.equal(storedProject.runtimeConfig.githubConnection.accountLogin, 'aizenshtat');
    assert.equal(storedProject.runtimeConfig.githubConnection.updatedAt, '2026-04-20T09:15:00.000Z');

    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;

    const persistedOnly = await getProjectGitHubConnection({
      params: { project: 'example' },
    });

    assert.equal(persistedOnly.status, 200);
    assert.equal(persistedOnly.body.githubConnection.status, 'unconfigured');
    assert.equal(persistedOnly.body.githubConnection.installationId, 91);
    assert.equal(persistedOnly.body.githubConnection.accountLogin, 'aizenshtat');
    assert.equal(persistedOnly.body.githubConnection.persistedStatus, 'connected');
  } finally {
    if (previousAppId == null) {
      delete process.env.GITHUB_APP_ID;
    } else {
      process.env.GITHUB_APP_ID = previousAppId;
    }

    if (previousPrivateKey == null) {
      delete process.env.GITHUB_APP_PRIVATE_KEY;
    } else {
      process.env.GITHUB_APP_PRIVATE_KEY = previousPrivateKey;
    }
  }
});

test('project github connection route reports a missing installation without failing the settings view', async () => {
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const persistence = createInMemoryContributionPersistenceAdapter({
    initialProjects: [
      {
        ...getProjectSeedRecord('example'),
        runtimeConfig: {
          ...getProjectSeedRecord('example').runtimeConfig,
          repositoryFullName: 'customer/orbital-ops',
          executionMode: 'hosted_remote_clone',
        },
      },
    ],
  });

  process.env.GITHUB_APP_ID = '12345';
  process.env.GITHUB_APP_PRIVATE_KEY = generatePrivateKeyPem();

  try {
    const handler = createProjectGitHubConnectionHandler({
      database: persistence,
      fetchImpl: async (url) => {
        if (url === 'https://api.github.com/app') {
          return new Response(
            JSON.stringify({
              id: 55,
              slug: 'aizenshtat-crowdship',
              name: 'Aizenshtat CrowdShip',
              html_url: 'https://github.com/apps/aizenshtat-crowdship',
              owner: {
                login: 'aizenshtat',
              },
            }),
            {
              status: 200,
              headers: {
                'content-type': 'application/json',
              },
            },
          );
        }

        if (url === 'https://api.github.com/repos/customer/orbital-ops/installation') {
          return new Response(
            JSON.stringify({
              message: 'Not Found',
            }),
            {
              status: 404,
              headers: {
                'content-type': 'application/json',
              },
            },
          );
        }

        throw new Error(`Unexpected fetch request: ${url}`);
      },
    });
    const response = await handler({
      params: { project: 'example' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.githubConnection.status, 'not_installed');
    assert.match(response.body.githubConnection.message, /not installed/i);
    assert.equal(
      response.body.githubConnection.installUrl,
      'https://github.com/apps/aizenshtat-crowdship/installations/new',
    );
  } finally {
    if (previousAppId == null) {
      delete process.env.GITHUB_APP_ID;
    } else {
      process.env.GITHUB_APP_ID = previousAppId;
    }

    if (previousPrivateKey == null) {
      delete process.env.GITHUB_APP_PRIVATE_KEY;
    } else {
      process.env.GITHUB_APP_PRIVATE_KEY = previousPrivateKey;
    }
  }
});

test('contribution creation validates project existence through persistence', async () => {
  const createContribution = createContributionHandler({
    database: createInMemoryContributionPersistenceAdapter({
      initialProjects: [],
    }),
    specService: createStubSpecService(),
  });
  const response = await createContribution({
    body: buildCreatePayload(),
  });

  assert.equal(response.status, 404);
  assert.equal(response.body.error, 'project_not_found');
  assert.equal(response.body.project, 'example');
});

test('contribution creation rejects a host origin outside the project allowlist', async () => {
  const createContribution = createContributionHandler({
    database: createInMemoryContributionPersistenceAdapter(),
    specService: createStubSpecService(),
  });

  const response = await createContribution({
    body: {
      ...buildCreatePayload(),
      hostOrigin: 'https://evil.test',
    },
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.error, 'origin_not_allowed');
  assert.equal(response.body.project, 'example');
  assert.equal(response.body.hostOrigin, 'https://evil.test');
});

test('contribution creation requires a browser-derived host origin', async () => {
  const createContribution = createContributionHandler({
    database: createInMemoryContributionPersistenceAdapter(),
    specService: createStubSpecService(),
  });

  const payload = buildCreatePayload();
  delete payload.hostOrigin;

  const response = await createContribution({
    body: payload,
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'invalid_contribution_payload');
  assert.match(response.body.issues[0], /hostOrigin is required/i);
});

test('connected contribution persistence opens clarification first and stores the first spec after a reply', async () => {
  const ids = [
    'contribution-123',
    'attachment-1',
    'message-1',
    'message-2',
    'progress-created',
    'progress-clarification',
    'message-3',
    'spec-1',
    'message-4',
    'progress-spec',
  ];
  const persistence = createInMemoryContributionPersistenceAdapter({
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const createContribution = createContributionHandler({
    database: persistence,
    specService: createStubSpecService(),
    idFactory: () => ids.shift(),
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const postMessage = createContributionMessageHandler({
    database: persistence,
    specService: createStubSpecService(),
    idFactory: () => ids.shift(),
    clock: () => new Date('2026-04-18T12:02:00Z'),
  });
  const getContribution = createContributionDetailHandler({ database: persistence });

  const response = await createContribution({
    body: buildCreatePayload(),
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.contribution.id, 'contribution-123');
  assert.equal(response.body.contribution.state, 'draft_chat');
  assert.equal(response.body.attachments.length, 1);
  assert.equal(response.body.attachments[0].filename, 'signal-drop-17.csv');
  assert.equal(response.body.conversation.length, 2);
  assert.equal(response.body.conversation[1].messageType, 'ask_user_questions');
  assert.equal(response.body.conversation[1].choices[0].choices[0].label, 'Launch replay from the selected anomaly');
  assert.equal(response.body.spec.current, null);
  assert.equal(response.body.lifecycle.events.length, 2);
  assert.equal(response.body.lifecycle.currentState, 'draft_chat');

  const clarified = await postMessage({
    params: { id: 'contribution-123' },
    body: {
      body: 'Let me start replay from the anomaly row, keep the filters in place, and keep the mission layout unchanged.',
    },
  });

  assert.equal(clarified.status, 200);
  assert.equal(clarified.body.contribution.state, SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE);
  assert.equal(clarified.body.spec.current.versionNumber, 1);
  assert.equal(clarified.body.conversation.length, 4);

  const detail = await getContribution({
    params: { id: 'contribution-123' },
  });

  assert.equal(detail.status, 200);
  assert.equal(detail.body.spec.current.id, 'spec-1');
  assert.equal(detail.body.conversation[0].authorRole, 'requester');
  assert.equal(detail.body.conversation[1].authorRole, 'agent');
});

test('connected contribution persistence forces a spec draft after capped clarification replies', async () => {
  const ids = [
    'contribution-123',
    'attachment-1',
    'message-1',
    'message-2',
    'progress-created',
    'progress-clarification',
    'message-3',
    'message-4',
    'progress-clarification-2',
    'message-5',
    'message-6',
    'progress-clarification-3',
    'message-7',
    'spec-1',
    'message-8',
    'progress-spec',
  ];
  const persistence = createInMemoryContributionPersistenceAdapter({
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const specService = {
    async startConversation({ contribution }) {
      return {
        action: 'ask_user',
        assistantMessage: `Before I draft the spec for ${contribution.title}, I need two quick details.`,
        questions: [
          {
            id: 'replay-content',
            question: 'What should replay show?',
            why: 'This defines scope.',
            suggestedAnswerFormat: 'Short sentence',
          },
          {
            id: 'replay-controls',
            question: 'Which controls are required?',
            why: 'This defines launch scope.',
            suggestedAnswerFormat: 'Short list',
          },
        ],
        metadata: {
          provider: 'stub',
          model: 'gpt-5.4',
        },
      };
    },
    async continueConversation() {
      return {
        action: 'ask_user',
        assistantMessage: 'I still need one more detail.',
        questions: [
          {
            id: 'replay-content-final',
            question: 'What should replay show in v1?',
            why: 'This defines scope.',
            suggestedAnswerFormat: 'Short sentence',
          },
        ],
        metadata: {
          provider: 'stub',
          model: 'gpt-5.4',
        },
      };
    },
    async finalizeConversation() {
      return {
        action: 'draft_spec',
        assistantMessage: 'I drafted the first approval-ready scope.',
        goal: 'Let operators replay the selected signal drop from the mission screen.',
        userProblem:
          'Operators can spot a signal drop but cannot inspect the telemetry leading into it without leaving the mission workflow.',
        acceptanceCriteria: [
          'The operator can launch replay from /mission for the selected anomaly.',
          'The replay keeps the mission layout and active filters visible.',
          'The replay includes the lead-up to the selected signal drop.',
        ],
        nonGoals: [
          'Redesigning unrelated mission-control flows.',
          'Changing authentication or permissions.',
        ],
        metadata: {
          provider: 'stub',
          model: 'gpt-5.4',
        },
      };
    },
  };
  const createContribution = createContributionHandler({
    database: persistence,
    specService,
    idFactory: () => ids.shift(),
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const postMessage = createContributionMessageHandler({
    database: persistence,
    specService,
    idFactory: () => ids.shift(),
    clock: () => new Date('2026-04-18T12:02:00Z'),
  });

  await createContribution({
    body: buildCreatePayload(),
  });

  const reply1 = await postMessage({
    params: { id: 'contribution-123' },
    body: {
      body: 'Keep replay on the mission screen.',
    },
  });
  assert.equal(reply1.status, 200);
  assert.equal(reply1.body.contribution.state, 'draft_chat');

  const reply2 = await postMessage({
    params: { id: 'contribution-123' },
    body: {
      body: 'Keep filters and layout visible.',
    },
  });
  assert.equal(reply2.status, 200);
  assert.equal(reply2.body.contribution.state, 'draft_chat');

  const reply3 = await postMessage({
    params: { id: 'contribution-123' },
    body: {
      body: 'Replay should show signal timeline and telemetry.',
    },
  });
  assert.equal(reply3.status, 200);
  assert.equal(reply3.body.contribution.state, SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE);
  assert.equal(reply3.body.spec.current.versionNumber, 1);
  assert.equal(reply3.body.conversation.at(-1).messageType, 'spec_ready');
});

test('connected contribution persistence supports refinement and approval', async () => {
  const ids = [
    'contribution-123',
    'attachment-1',
    'message-1',
    'message-2',
    'progress-created',
    'progress-clarification',
    'message-3',
    'spec-1',
    'message-4',
    'progress-spec',
    'spec-2',
    'message-5',
    'message-6',
    'progress-refined',
    'message-7',
    'progress-approved',
  ];
  const persistence = createInMemoryContributionPersistenceAdapter({
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const createContribution = createContributionHandler({
    database: persistence,
    specService: createStubSpecService(),
    idFactory: () => ids.shift(),
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const postMessage = createContributionMessageHandler({
    database: persistence,
    specService: createStubSpecService(),
    idFactory: () => ids.shift(),
    clock: () => new Date('2026-04-18T12:03:00Z'),
  });
  const specApproval = createSpecApprovalHandler({
    database: persistence,
    specService: createStubSpecService(),
    idFactory: () => ids.shift(),
    clock: () => new Date('2026-04-18T12:05:00Z'),
  });

  await createContribution({
    body: buildCreatePayload(),
  });
  await postMessage({
    params: { id: 'contribution-123' },
    body: {
      body: 'Replay should open from the anomaly row and keep the mission layout unchanged.',
    },
  });

  const refined = await specApproval({
    params: { id: 'contribution-123' },
    body: {
      decision: 'refine',
      note: 'Keep the replay controls visible on the same mission surface.',
    },
  });

  assert.equal(refined.status, 200);
  assert.equal(refined.body.contribution.state, SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE);
  assert.equal(refined.body.spec.current.versionNumber, 2);
  assert.match(refined.body.spec.current.userProblem, /Latest refinement/i);
  assert.equal(refined.body.conversation.length, 6);

  const approved = await specApproval({
    params: { id: 'contribution-123' },
    body: {
      decision: 'approve',
    },
  });

  assert.equal(approved.status, 200);
  assert.equal(approved.body.contribution.state, SPEC_APPROVED_CONTRIBUTION_STATE);
  assert.equal(approved.body.spec.current.versionNumber, 2);
  assert.equal(typeof approved.body.spec.current.approvedAt, 'string');
  assert.equal(approved.body.lifecycle.currentState, SPEC_APPROVED_CONTRIBUTION_STATE);
});

test('connected contribution persistence lists created contributions with latest spec metadata', async () => {
  const ids = [
    'contribution-123',
    'attachment-1',
    'message-1',
    'message-2',
    'progress-created',
    'progress-clarification',
    'contribution-789',
    'attachment-2',
    'message-3',
    'message-4',
    'progress-created-2',
    'progress-clarification-2',
  ];
  const persistence = createInMemoryContributionPersistenceAdapter({
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const createContribution = createContributionHandler({
    database: persistence,
    specService: createStubSpecService(),
    idFactory: () => ids.shift(),
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const listContributions = createRouteHandlers({ database: persistence }).getContributions;

  await createContribution({
    body: buildCreatePayload(),
  });
  await createContribution({
    body: {
      ...buildCreatePayload(),
      type: 'bug_report',
      title: 'Fix telemetry context expansion on mobile',
      attachments: [],
    },
  });

  const response = await listContributions();

  assert.equal(response.status, 200);
  assert.equal(response.body.contributions.length, 2);
  assert.equal(response.body.contributions[0].latestSpecVersion, null);
  assert.equal(response.body.contributions[0].state, 'draft_chat');
});

test('contribution list can be scoped to the requester identity for widget history', async () => {
  const ids = [
    'requester-one',
    'attachment-1',
    'message-1',
    'message-2',
    'progress-created',
    'progress-clarification',
    'requester-two',
    'attachment-2',
    'message-3',
    'message-4',
    'progress-created-2',
    'requester-session',
    'message-5',
    'message-6',
    'progress-created-3',
    'progress-clarification-2',
  ];
  const persistence = createInMemoryContributionPersistenceAdapter();
  const createContribution = createContributionHandler({
    database: persistence,
    specService: createStubSpecService(),
    idFactory: () => ids.shift(),
  });
  const listContributions = createRouteHandlers({ database: persistence }).getContributions;

  await createContribution({
    body: buildCreatePayload(),
  });
  await createContribution({
    body: {
      ...buildCreatePayload(),
      title: 'Another customer request',
      attachments: [],
      user: {
        id: 'customer-456',
        email: 'other@example.com',
        role: 'customer',
      },
    },
  });
  await createContribution({
    body: {
      ...buildCreatePayload(),
      title: 'Anonymous browser request',
      attachments: [],
      user: {
        requesterSessionId: 'crqs_browser_session_123',
        role: 'requester',
      },
    },
  });

  const response = await listContributions({
    query: {
      project: 'example',
      requesterUserId: 'customer-123',
      limit: '5',
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.contributions.length, 1);
  assert.equal(response.body.contributions[0].id, 'requester-one');

  const sessionResponse = await listContributions({
    query: {
      project: 'example',
      requesterSessionId: 'crqs_browser_session_123',
      limit: '5',
    },
  });

  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionResponse.body.contributions.length, 1);
  assert.equal(sessionResponse.body.contributions[0].id, 'requester-session');
});

test('contribution progress fails safely without persistence', async () => {
  const getContributionProgress = createContributionProgressHandler();
  const response = await getContributionProgress({
    params: { id: 'contribution-123' },
  });

  assert.equal(response.status, 501);
  assert.match(response.body.message, /not wired/i);
  assert.equal('events' in response.body, false);
});

test('configured persistence can require DATABASE_URL before falling back to memory', () => {
  assert.throws(
    () => createConfiguredContributionPersistenceAdapter({ requireDatabase: true }),
    /DATABASE_URL is required when database persistence is enforced/i,
  );
});

test('api server persists contributions and spec approval through the real http runtime', async () => {
  const server = createApiServer({
    specService: createStubSpecService(),
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    assert.ok(address);

    const contribution = await requestJson({
      port: address.port,
      method: 'POST',
      path: '/api/v1/contributions',
      body: buildCreatePayload(),
    });

    assert.equal(contribution.status, 201);
    assert.equal(contribution.body.contribution.projectSlug, 'example');
    assert.equal(contribution.body.lifecycle.currentState, 'draft_chat');
    assert.equal(contribution.body.spec.current, null);

    const detail = await requestJson({
      port: address.port,
      method: 'GET',
      path: `/api/v1/contributions/${contribution.body.contribution.id}`,
    });

    assert.equal(detail.status, 200);
    assert.equal(detail.body.contribution.id, contribution.body.contribution.id);
    assert.equal(detail.body.conversation.length, 2);

    const clarified = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contribution.body.contribution.id}/messages`,
      body: {
        body: 'Replay should open from the anomaly row and keep the mission layout unchanged.',
      },
    });

    assert.equal(clarified.status, 200);
    assert.equal(clarified.body.contribution.state, SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE);
    assert.equal(clarified.body.spec.current.versionNumber, 1);

    const approval = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contribution.body.contribution.id}/spec-approval`,
      body: {
        decision: 'approve',
      },
    });

    assert.equal(approval.status, 200);
    assert.equal(approval.body.contribution.state, SPEC_APPROVED_CONTRIBUTION_STATE);

    const progress = await requestJson({
      port: address.port,
      method: 'GET',
      path: `/api/v1/contributions/${contribution.body.contribution.id}/progress`,
    });

    assert.equal(progress.status, 200);
    assert.equal(progress.body.contribution.id, contribution.body.contribution.id);
    assert.equal(progress.body.lifecycle.currentState, SPEC_APPROVED_CONTRIBUTION_STATE);
    assert.equal(progress.body.lifecycle.events.at(-1).kind, 'spec_approved');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('approved specs auto-queue implementation when project settings enable it', async () => {
  const seed = getProjectSeedRecord('example');
  const database = createInMemoryContributionPersistenceAdapter({
    initialProjects: [
      {
        ...seed,
        runtimeConfig: {
          ...seed.runtimeConfig,
          autoQueueImplementation: true,
          implementationTimeoutMinutes: 45,
        },
      },
    ],
  });
  const { postContribution, postContributionMessage, postSpecApproval } = createRouteHandlers({
    database,
    specService: createStubSpecService(),
  });

  const created = await postContribution({
    body: buildCreatePayload(),
  });
  const contributionId = created.body.contribution.id;

  await postContributionMessage({
    params: { id: contributionId },
    body: {
      body: 'Replay should open from the anomaly row and keep the mission layout unchanged.',
    },
  });

  const approved = await postSpecApproval({
    params: { id: contributionId },
    body: {
      decision: 'approve',
    },
  });

  assert.equal(approved.status, 200);
  assert.equal(approved.body.contribution.state, 'agent_queued');
  assert.equal(approved.body.review.implementation.current.status, 'queued');
  assert.equal(approved.body.review.implementation.current.metadata.projectRuntimeConfig.autoQueueImplementation, true);
  assert.equal(approved.body.review.implementation.current.metadata.projectRuntimeConfig.implementationTimeoutMinutes, 45);
  assert.equal(approved.body.lifecycle.events.at(-2).kind, 'spec_approved');
  assert.equal(approved.body.lifecycle.events.at(-1).kind, 'implementation_queued');
});

test('api server streams contribution snapshots through the real http runtime', async () => {
  const server = createApiServer({
    specService: createStubSpecService(),
    progressStreamPollMs: 20,
    keepAliveMs: 200,
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  let stream = null;

  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    assert.ok(address);

    const created = await requestJson({
      port: address.port,
      method: 'POST',
      path: '/api/v1/contributions',
      body: buildCreatePayload(),
    });

    assert.equal(created.status, 201);
    const contributionId = created.body.contribution.id;

    stream = await openEventStream({
      port: address.port,
      path: `/api/v1/contributions/${contributionId}/stream`,
    });

    assert.equal(stream.status, 200);
    assert.match(String(stream.headers['content-type'] || ''), /^text\/event-stream\b/);

    const initialEvent = await stream.nextEvent();
    assert.equal(initialEvent.event, 'snapshot');
    const initialPayload = JSON.parse(initialEvent.data);
    assert.equal(initialPayload.contributionId, contributionId);
    assert.equal(initialPayload.contribution.state, 'draft_chat');
    assert.equal(initialPayload.contributionDetail.contribution.id, contributionId);

    const clarified = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/messages`,
      body: {
        body: 'Replay should open from the anomaly row and keep the mission layout unchanged.',
      },
    });

    assert.equal(clarified.status, 200);
    assert.equal(clarified.body.contribution.state, SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE);

    const updatedEvent = await stream.nextEvent();
    assert.equal(updatedEvent.event, 'snapshot');
    const updatedPayload = JSON.parse(updatedEvent.data);
    assert.equal(updatedPayload.contribution.state, SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE);
    assert.equal(updatedPayload.lifecycle.currentState, SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE);
    assert.equal(updatedPayload.contributionDetail.spec.current.versionNumber, 1);
  } finally {
    if (stream) {
      stream.close();
    }
    await new Promise((resolve) => server.close(resolve));
  }
});

test('preview approval can auto-open voting and vote threshold can auto-flag core review', async () => {
  const seed = getProjectSeedRecord('example');
  const database = createInMemoryContributionPersistenceAdapter({
    initialProjects: [
      {
        ...seed,
        runtimeConfig: {
          ...seed.runtimeConfig,
          autoOpenVoting: true,
          coreReviewVoteThreshold: 1,
        },
      },
    ],
  });
  const handlers = createRouteHandlers({
    database,
    specService: createStubSpecService(),
  });

  const created = await handlers.postContribution({
    body: buildCreatePayload(),
  });
  const contributionId = created.body.contribution.id;

  await handlers.postContributionMessage({
    params: { id: contributionId },
    body: {
      body: 'Replay should open from the anomaly row and keep the mission layout unchanged.',
    },
  });
  await handlers.postSpecApproval({
    params: { id: contributionId },
    body: {
      decision: 'approve',
    },
  });
  await handlers.postQueueImplementation({
    params: { id: contributionId },
    body: {
      queueName: 'default',
      repositoryFullName: 'aizenshtat/example',
      branchName: 'crowdship/contribution-123',
    },
  });
  await handlers.postPullRequest({
    params: { id: contributionId },
    body: {
      repositoryFullName: 'aizenshtat/example',
      number: 42,
      url: 'https://github.com/aizenshtat/example/pull/42',
      branchName: 'crowdship/contribution-123',
      status: 'open',
    },
  });
  await handlers.postPreviewDeployment({
    params: { id: contributionId },
    body: {
      url: 'https://example.aizenshtat.eu/previews/contribution-123/',
      status: 'ready',
      deployKind: 'manual_preview',
    },
  });

  const previewApproval = await handlers.postPreviewReview({
    params: { id: contributionId },
    body: {
      decision: 'approve',
    },
  });

  assert.equal(previewApproval.status, 200);
  assert.equal(previewApproval.body.contribution.state, 'voting_open');
  assert.equal(previewApproval.body.lifecycle.events.at(-2).kind, 'preview_approved');
  assert.equal(previewApproval.body.lifecycle.events.at(-1).kind, 'voting_opened');

  const vote = await handlers.postVote({
    params: { id: contributionId },
    body: {
      voteType: 'approve',
      voterUserId: 'jury-1',
    },
  });

  assert.equal(vote.status, 201);
  assert.equal(vote.body.contribution.state, 'core_team_flagged');
  assert.equal(vote.body.lifecycle.events.at(-1).kind, 'core_review_flagged');
});

test('api server does not expose wildcard cors headers on private routes', async () => {
  const server = createApiServer({
    specService: createStubSpecService(),
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    assert.ok(address);

    const project = await requestJson({
      port: address.port,
      method: 'GET',
      path: '/api/v1/projects/example',
      headers: {
        origin: 'https://evil.test',
      },
    });

    assert.equal(project.status, 200);
    assert.equal(project.headers['access-control-allow-origin'], undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('api server supports delivery evidence, voting, and merged state through the real http runtime', async () => {
  const server = createApiServer({
    completionService: {
      async summarizeCompletion({ fallbackSummary }) {
        return {
          summary: fallbackSummary,
          metadata: {
            provider: 'fallback',
            reason: 'test stub',
          },
        };
      },
    },
    specService: createStubSpecService(),
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    assert.ok(address);

    const contribution = await requestJson({
      port: address.port,
      method: 'POST',
      path: '/api/v1/contributions',
      body: buildCreatePayload(),
    });

    const contributionId = contribution.body.contribution.id;

    const clarified = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/messages`,
      body: {
        body: 'Replay should open from the anomaly row and keep the mission layout unchanged.',
      },
    });

    assert.equal(clarified.status, 200);
    assert.equal(clarified.body.contribution.state, SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE);

    const approval = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/spec-approval`,
      body: {
        decision: 'approve',
      },
    });

    assert.equal(approval.status, 200);
    assert.equal(approval.body.contribution.state, SPEC_APPROVED_CONTRIBUTION_STATE);

    const queued = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/queue-implementation`,
      body: {
        queueName: 'default',
        repositoryFullName: 'aizenshtat/example',
        branchName: 'crowdship/contribution-123',
      },
    });

    assert.equal(queued.status, 200);
    assert.equal(queued.body.contribution.state, 'agent_queued');
    assert.equal(queued.body.review.implementation.jobs.length, 1);
    assert.equal(
      queued.body.review.implementation.jobs[0].metadata.projectRuntimeConfig.repositoryFullName,
      'aizenshtat/example',
    );
    assert.equal(
      queued.body.review.implementation.jobs[0].metadata.projectRuntimeConfig.previewUrlPattern,
      'https://example.aizenshtat.eu/previews/{contributionId}/',
    );
    assert.equal(
      queued.body.review.implementation.jobs[0].metadata.projectRuntimeConfig.executionMode,
      'hosted_remote_clone',
    );

    const pullRequest = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/pull-requests`,
      body: {
        repositoryFullName: 'aizenshtat/example',
        number: 42,
        url: 'https://github.com/aizenshtat/example/pull/42',
        branchName: 'crowdship/contribution-123',
        status: 'open',
      },
    });

    assert.equal(pullRequest.status, 200);
    assert.equal(pullRequest.body.contribution.state, 'pr_opened');
    assert.equal(pullRequest.body.review.pullRequests.length, 1);

    const preview = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/preview-deployments`,
      body: {
        url: 'https://example.aizenshtat.eu/previews/contribution-123/',
        status: 'ready',
        deployKind: 'manual_preview',
      },
    });

    assert.equal(preview.status, 200);
    assert.equal(preview.body.contribution.state, 'preview_ready');
    assert.equal(preview.body.review.previewDeployments.length, 1);

    const voting = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/open-voting`,
      body: {},
    });

    assert.equal(voting.status, 409);
    assert.equal(voting.body.error, 'requester_preview_approval_required');

    const previewApproval = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/preview-review`,
      body: {
        decision: 'approve',
      },
    });

    assert.equal(previewApproval.status, 200);
    assert.equal(previewApproval.body.contribution.state, 'ready_for_voting');
    assert.equal(previewApproval.body.lifecycle.events.at(-1).kind, 'preview_approved');

    const votingAfterApproval = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/open-voting`,
      body: {},
    });

    assert.equal(votingAfterApproval.status, 200);
    assert.equal(votingAfterApproval.body.contribution.state, 'voting_open');

    const vote = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/votes`,
      body: {
        voteType: 'approve',
        voterUserId: 'jury-1',
      },
    });

    assert.equal(vote.status, 201);
    assert.equal(vote.body.review.votes.summary.approve, 1);
    assert.equal(vote.body.review.votes.summary.total, 1);

    const comment = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/comments`,
      body: {
        authorRole: 'core_team',
        body: 'Ready to merge after review.',
        disposition: 'note',
      },
    });

    assert.equal(comment.status, 201);
    assert.equal(comment.body.review.comments.length, 1);

    const updatedComment = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/comments/${comment.body.review.comments[0].id}/disposition`,
      body: {
        disposition: 'incorporated',
      },
    });

    assert.equal(updatedComment.status, 200);
    assert.equal(updatedComment.body.review.comments[0].disposition, 'incorporated');

    const flagged = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/flag-core-review`,
      body: {},
    });

    assert.equal(flagged.status, 200);
    assert.equal(flagged.body.contribution.state, 'core_team_flagged');

    const coreReview = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/start-core-review`,
      body: {},
    });

    assert.equal(coreReview.status, 200);
    assert.equal(coreReview.body.contribution.state, 'core_review');

    const mergedPullRequest = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/pull-requests`,
      body: {
        repositoryFullName: 'aizenshtat/example',
        number: 42,
        url: 'https://github.com/aizenshtat/example/pull/42',
        branchName: 'crowdship/contribution-123',
        status: 'merged',
      },
    });

    assert.equal(mergedPullRequest.status, 200);

    const merged = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/mark-merged`,
      body: {},
    });

    assert.equal(merged.status, 200);
    assert.equal(merged.body.contribution.state, 'merged');
    assert.equal(merged.body.review.pullRequests.length, 2);
    assert.equal(merged.body.lifecycle.events.at(-1).kind, 'merged_recorded');

    const productionDeploy = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/start-production-deploy`,
      body: {},
    });

    assert.equal(productionDeploy.status, 200);
    assert.equal(productionDeploy.body.contribution.state, 'production_deploying');

    const completed = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/complete`,
      body: {},
    });

    assert.equal(completed.status, 200);
    assert.equal(completed.body.contribution.state, 'completed');
    assert.equal(completed.body.lifecycle.events.at(-1).kind, 'completed_recorded');
    assert.equal(completed.body.conversation.at(-1).messageType, 'completion_summary');
    assert.equal(completed.body.conversation.at(-1).metadata.completionSummary.provider, 'fallback');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('preview evidence route returns the latest live preview record for a recorded pull request', async () => {
  const persistence = createInMemoryContributionPersistenceAdapter({
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const specService = createStubSpecService();
  let contributionId = null;
  const server = createApiServer({
    database: persistence,
    previewEvidenceService: {
      async getPreviewEvidence({ repositoryFullName, pullRequestNumber, contributionId: requestedContributionId }) {
        assert.equal(repositoryFullName, 'aizenshtat/example');
        assert.equal(pullRequestNumber, 42);
        assert.equal(requestedContributionId, contributionId);

        return {
          repositoryFullName,
          pullRequestNumber,
          status: 'ready',
          statusLabel: 'ready',
          contributionId: requestedContributionId,
          branch: `crowdship/${requestedContributionId}-live-preview-evidence`,
          pullRequestUrl: 'https://github.com/aizenshtat/example/pull/42',
          runUrl: 'https://github.com/aizenshtat/example/actions/runs/123456789',
          buildStatus: 'success',
          buildStatusLabel: 'success',
          previewUrl: `https://example.aizenshtat.eu/previews/${requestedContributionId}/`,
          previewUrlLabel: `https://example.aizenshtat.eu/previews/${requestedContributionId}/`,
          sentryRelease: 'example@abc123def456',
          sentryReleaseLabel: '`example@abc123def456`',
          sentryIssuesUrl: `https://crowdship.sentry.io/issues/?query=contribution_id%3A${requestedContributionId}`,
          newUnhandledPreviewErrors: null,
          newUnhandledPreviewErrorsLabel: 'unavailable until runtime Sentry tagging is wired into the app',
          failedPreviewSessions: null,
          failedPreviewSessionsLabel: 'unavailable until Session Replay is configured',
          commentUrl: 'https://github.com/aizenshtat/example/pull/42#issuecomment-1234567890',
          sourceUpdatedAt: '2026-04-18T12:10:00Z',
        };
      },
    },
    specService,
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const createResponse = await requestJson({
      port: address.port,
      method: 'POST',
      path: '/api/v1/contributions',
      body: {
        ...buildCreatePayload(),
        title: 'Add live preview evidence',
      },
    });

    contributionId = createResponse.body.contribution.id;

    const clarified = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/messages`,
      body: {
        body: 'Keep the anomaly replay on the same mission surface.',
      },
    });

    assert.equal(clarified.status, 200);
    assert.equal(clarified.body.contribution.state, SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE);

    const approved = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/spec-approval`,
      body: {
        decision: 'approve',
      },
    });

    assert.equal(approved.status, 200);
    assert.equal(approved.body.contribution.state, SPEC_APPROVED_CONTRIBUTION_STATE);

    const pullRequest = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/pull-requests`,
      body: {
        repositoryFullName: 'aizenshtat/example',
        number: 42,
        url: 'https://github.com/aizenshtat/example/pull/42',
        branchName: `crowdship/${contributionId}-live-preview-evidence`,
        status: 'open',
      },
    });

    assert.equal(pullRequest.status, 200);
    assert.equal(pullRequest.body.review.pullRequests.length, 1);

    const previewEvidence = await requestJson({
      port: address.port,
      method: 'GET',
      path: `/api/v1/contributions/${contributionId}/preview-evidence`,
    });

    assert.equal(previewEvidence.status, 200);
    assert.equal(previewEvidence.body.contributionId, contributionId);
    assert.equal(previewEvidence.body.pullRequest.number, 42);
    assert.equal(previewEvidence.body.evidence.status, 'ready');
    assert.equal(
      previewEvidence.body.evidence.previewUrl,
      `https://example.aizenshtat.eu/previews/${contributionId}/`,
    );
    assert.equal(
      previewEvidence.body.evidence.commentUrl,
      'https://github.com/aizenshtat/example/pull/42#issuecomment-1234567890',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('ci status route rejects requests without the configured project token', async () => {
  const persistence = createInMemoryContributionPersistenceAdapter();
  const token = await setProjectCiStatusToken(persistence);
  const server = createApiServer({
    database: persistence,
    specService: createStubSpecService(),
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const created = await requestJson({
      port: address.port,
      method: 'POST',
      path: '/api/v1/contributions',
      body: buildCreatePayload(),
    });

    assert.equal(created.status, 201);
    const contributionId = created.body.contribution.id;

    const forbidden = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/ci-status`,
      headers: {
        'x-crowdship-ci-token': `${token}-invalid`,
      },
      body: {
        environment: 'preview',
        buildStatus: 'success',
        previewStatus: 'ready',
        previewUrl: `https://example.aizenshtat.eu/previews/${contributionId}/`,
      },
    });

    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error, 'ci_status_forbidden');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('ci status route stores preview evidence and preview evidence reads the stored record first', async () => {
  const persistence = createInMemoryContributionPersistenceAdapter({
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const token = await setProjectCiStatusToken(persistence);
  const server = createApiServer({
    database: persistence,
    previewEvidenceService: {
      async getPreviewEvidence() {
        assert.fail('preview evidence service should not be called when stored callback evidence exists');
      },
    },
    specService: createStubSpecService(),
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const created = await requestJson({
      port: address.port,
      method: 'POST',
      path: '/api/v1/contributions',
      body: buildCreatePayload(),
    });

    assert.equal(created.status, 201);
    const contributionId = created.body.contribution.id;

    const clarified = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/messages`,
      body: {
        body: 'Keep the anomaly replay on the mission surface and preserve current filters.',
      },
    });

    assert.equal(clarified.status, 200);
    assert.equal(clarified.body.contribution.state, SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE);

    const approved = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/spec-approval`,
      body: {
        decision: 'approve',
      },
    });

    assert.equal(approved.status, 200);
    assert.equal(approved.body.contribution.state, SPEC_APPROVED_CONTRIBUTION_STATE);

    const pullRequest = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/pull-requests`,
      body: {
        repositoryFullName: 'aizenshtat/example',
        number: 42,
        url: 'https://github.com/aizenshtat/example/pull/42',
        branchName: `crowdship/${contributionId}-ci-status`,
        status: 'open',
      },
    });

    assert.equal(pullRequest.status, 200);

    const previewStatus = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/ci-status`,
      headers: {
        'x-crowdship-ci-token': token,
      },
      body: {
        environment: 'preview',
        buildStatus: 'success',
        previewStatus: 'ready',
        previewUrl: `https://example.aizenshtat.eu/previews/${contributionId}/`,
        repositoryFullName: 'aizenshtat/example',
        pullRequestNumber: 42,
        pullRequestUrl: 'https://github.com/aizenshtat/example/pull/42',
        branch: `crowdship/${contributionId}-ci-status`,
        runId: '123456789',
        runUrl: 'https://github.com/aizenshtat/example/actions/runs/123456789',
        sentryRelease: 'example@abc123',
        sentryIssuesUrl: `https://sentry.example.invalid/issues/?query=${contributionId}`,
        newUnhandledPreviewErrors: 0,
        failedPreviewSessions: 0,
        updatedAt: '2026-04-18T12:10:00Z',
      },
    });

    assert.equal(previewStatus.status, 202);
    assert.equal(previewStatus.body.contribution.state, 'preview_ready');
    assert.equal(previewStatus.body.review.previewDeployments.length, 1);
    assert.equal(previewStatus.body.review.previewDeployments.at(-1).status, 'ready');

    const previewEvidence = await requestJson({
      port: address.port,
      method: 'GET',
      path: `/api/v1/contributions/${contributionId}/preview-evidence`,
    });

    assert.equal(previewEvidence.status, 200);
    assert.equal(previewEvidence.body.pullRequest.number, 42);
    assert.equal(previewEvidence.body.evidence.status, 'ready');
    assert.equal(previewEvidence.body.evidence.previewUrl, `https://example.aizenshtat.eu/previews/${contributionId}/`);
    assert.equal(previewEvidence.body.evidence.runUrl, 'https://github.com/aizenshtat/example/actions/runs/123456789');
    assert.equal(previewEvidence.body.evidence.sentryRelease, 'example@abc123');
    assert.equal(previewEvidence.body.evidence.newUnhandledPreviewErrors, 0);
    assert.equal(previewEvidence.body.evidence.failedPreviewSessions, 0);
    assert.equal(previewEvidence.body.evidence.sourceUpdatedAt, '2026-04-18T12:10:00.000Z');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('production ci status callback can complete a merged contribution', async () => {
  const persistence = createInMemoryContributionPersistenceAdapter({
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const token = await setProjectCiStatusToken(persistence);
  const server = createApiServer({
    database: persistence,
    completionService: {
      async summarizeCompletion() {
        return {
          summary: 'Relay shadow markers are now live in production.',
          metadata: {
            provider: 'stub',
            model: 'gpt-5.4',
          },
        };
      },
    },
    specService: createStubSpecService(),
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const created = await requestJson({
      port: address.port,
      method: 'POST',
      path: '/api/v1/contributions',
      body: buildCreatePayload(),
    });

    assert.equal(created.status, 201);
    const contributionId = created.body.contribution.id;

    const clarified = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/messages`,
      body: {
        body: 'Launch the replay from the selected anomaly and keep the current mission context intact.',
      },
    });

    assert.equal(clarified.status, 200);
    assert.equal(clarified.body.contribution.state, SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE);

    const approved = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/spec-approval`,
      body: {
        decision: 'approve',
      },
    });

    assert.equal(approved.status, 200);
    assert.equal(approved.body.contribution.state, SPEC_APPROVED_CONTRIBUTION_STATE);

    const pullRequest = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/pull-requests`,
      body: {
        repositoryFullName: 'aizenshtat/example',
        number: 77,
        url: 'https://github.com/aizenshtat/example/pull/77',
        branchName: `crowdship/${contributionId}-relay-shadow-markers`,
        status: 'merged',
      },
    });

    assert.equal(pullRequest.status, 200);

    const merged = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/mark-merged`,
      body: {},
    });

    assert.equal(merged.status, 200);
    assert.equal(merged.body.contribution.state, 'merged');

    const productionStatus = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/ci-status`,
      headers: {
        'x-crowdship-ci-token': token,
      },
      body: {
        environment: 'production',
        buildStatus: 'success',
        productionStatus: 'published',
        productionUrl: 'https://example.aizenshtat.eu/mission',
        repositoryFullName: 'aizenshtat/example',
        pullRequestNumber: 77,
        pullRequestUrl: 'https://github.com/aizenshtat/example/pull/77',
        branch: `crowdship/${contributionId}-relay-shadow-markers`,
        runId: '987654321',
        runUrl: 'https://github.com/aizenshtat/example/actions/runs/987654321',
        gitSha: 'abc123def456',
        sentryRelease: 'example@abc123def456',
        updatedAt: '2099-01-01T00:00:00Z',
      },
    });

    assert.equal(productionStatus.status, 202);
    assert.equal(productionStatus.body.contribution.state, 'completed');
    assert.equal(productionStatus.body.lifecycle.events.at(-1).kind, 'completed_recorded');
    assert.equal(productionStatus.body.conversation.at(-1).messageType, 'completion_summary');
    assert.equal(productionStatus.body.conversation.at(-1).body, 'Relay shadow markers are now live in production.');
    assert.equal(productionStatus.body.conversation.at(-1).metadata.completionSummary.provider, 'stub');
    assert.equal(productionStatus.body.review.pullRequests.at(-1).status, 'merged');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('owner clarification request reopens the requester clarification loop', async () => {
  const server = createApiServer({
    database: createInMemoryContributionPersistenceAdapter(),
    specService: createStubSpecService(),
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;

    const created = await requestJson({
      port,
      method: 'POST',
      path: '/api/v1/contributions',
      body: buildCreatePayload(),
    });

    assert.equal(created.status, 201);
    const contributionId = created.body.contribution.id;

    const firstReply = await requestJson({
      port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/messages`,
      body: { body: 'Launch replay from the selected anomaly and keep current warning thresholds unchanged.' },
    });

    assert.equal(firstReply.status, 200);
    assert.equal(firstReply.body.contribution.state, 'spec_pending_approval');

    const clarification = await requestJson({
      port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/request-clarification`,
      body: { note: 'Which anomaly thresholds should stay unchanged while replay is added?' },
    });

    assert.equal(clarification.status, 200);
    assert.equal(clarification.body.contribution.state, 'draft_chat');
    assert.equal(clarification.body.lifecycle.events.at(-1).kind, 'clarification_requested');
    assert.equal(clarification.body.conversation.at(-1).messageType, 'ask_user_questions');
    assert.equal(clarification.body.review.comments.at(-1).disposition, 'needs_requester_review');

    const reply = await requestJson({
      port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/messages`,
      body: { body: 'Keep the existing warning and critical thresholds unchanged.' },
    });

    assert.equal(reply.status, 200);
    assert.equal(reply.body.contribution.state, 'spec_pending_approval');
    assert.equal(reply.body.spec.current.versionNumber, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('archive action closes a contribution through the rejected state', async () => {
  const server = createApiServer({
    database: createInMemoryContributionPersistenceAdapter(),
    specService: createStubSpecService(),
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;

    const created = await requestJson({
      port,
      method: 'POST',
      path: '/api/v1/contributions',
      body: buildCreatePayload(),
    });

    assert.equal(created.status, 201);
    const contributionId = created.body.contribution.id;

    const archived = await requestJson({
      port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/archive`,
      body: { note: 'Closing this until the mission replay direction is narrowed.' },
    });

    assert.equal(archived.status, 200);
    assert.equal(archived.body.contribution.state, 'rejected');
    assert.equal(archived.body.lifecycle.events.at(-1).kind, 'rejected_recorded');
    assert.equal(archived.body.review.comments.at(-1).disposition, 'rejected');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('requesting preview changes creates a revision state and allows implementation to be re-queued', async () => {
  const server = createApiServer({
    database: createInMemoryContributionPersistenceAdapter(),
    specService: createStubSpecService(),
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const contribution = await requestJson({
      port: address.port,
      method: 'POST',
      path: '/api/v1/contributions',
      body: {
        project: 'example',
        environment: 'production',
        type: 'feature_request',
        title: 'Add inline anomaly replay',
        body: 'Replay the selected signal drop without leaving the mission view.',
        hostOrigin: 'https://example.aizenshtat.eu',
        route: '/mission',
      },
    });

    const contributionId = contribution.body.contribution.id;

    await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/spec-approval`,
      body: {
        decision: 'approve',
      },
    });

    await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/queue-implementation`,
      body: {
        repositoryFullName: 'aizenshtat/example',
        branchName: 'crowdship/contribution-456',
      },
    });

    await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/pull-requests`,
      body: {
        repositoryFullName: 'aizenshtat/example',
        number: 56,
        url: 'https://github.com/aizenshtat/example/pull/56',
        branchName: 'crowdship/contribution-456',
        status: 'open',
      },
    });

    await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/preview-deployments`,
      body: {
        url: 'https://example.aizenshtat.eu/previews/contribution-456/',
        status: 'ready',
        deployKind: 'manual_preview',
      },
    });

    const revisionRequest = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/preview-review`,
      body: {
        decision: 'request_changes',
        note: 'Keep the replay scrubber pinned above the fold.',
      },
    });

    assert.equal(revisionRequest.status, 200);
    assert.equal(revisionRequest.body.contribution.state, 'revision_requested');
    assert.equal(revisionRequest.body.review.comments.at(-1).disposition, 'action_required');
    assert.equal(revisionRequest.body.lifecycle.events.at(-1).kind, 'preview_changes_requested');

    const requeue = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/queue-implementation`,
      body: {
        repositoryFullName: 'aizenshtat/example',
        branchName: 'crowdship/contribution-456-v2',
      },
    });

    assert.equal(requeue.status, 200);
    assert.equal(requeue.body.contribution.state, 'agent_queued');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('preview deployment failures surface a first-class failed contribution state in summaries', async () => {
  const server = createApiServer({
    specService: createStubSpecService(),
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Test server did not expose an address.');
    }

    const created = await requestJson({
      port: address.port,
      method: 'POST',
      path: '/api/v1/contributions',
      body: {
        ...buildCreatePayload(),
        title: 'Retry failed preview deploys',
        body: 'Let owners see when preview deploys fail.',
      },
    });

    const contributionId = created.body.contribution.id;

    await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/messages`,
      body: {
        body: 'Show the failure where owners already review the request.',
      },
    });

    await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/spec-approval`,
      body: {
        decision: 'approve',
      },
    });

    await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/queue-implementation`,
      body: {},
    });

    const failedPreview = await requestJson({
      port: address.port,
      method: 'POST',
      path: `/api/v1/contributions/${contributionId}/preview-deployments`,
      body: {
        url: 'https://example.aizenshtat.eu/previews/contribution-999/',
        status: 'failed',
        deployKind: 'manual_preview',
        errorSummary: 'Preview path returned 404.',
      },
    });

    assert.equal(failedPreview.status, 200);
    assert.equal(failedPreview.body.contribution.state, 'preview_failed');
    assert.equal(failedPreview.body.review.previewDeployments.at(-1).status, 'failed');

    const listResponse = await requestJson({
      port: address.port,
      method: 'GET',
      path: '/api/v1/contributions',
    });

    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.body.contributions[0].adminBucket, 'attention');
    assert.equal(listResponse.body.contributions[0].latestPreviewDeployment.status, 'failed');
    assert.equal(listResponse.body.contributions[0].latestPreviewDeployment.errorSummary, 'Preview path returned 404.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
