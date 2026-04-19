import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
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

function requestJson({ port, method, path, body }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? '' : JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: payload
          ? {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(payload),
            }
          : undefined,
      },
      (res) => {
        const chunks = [];

        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode,
            body: raw ? JSON.parse(raw) : null,
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
          });
        });
      },
    );

    req.on('error', reject);
    req.write(body);
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
      'GET /api/v1/health',
      'GET /api/v1/demo-video',
      'POST /api/v1/demo-video/upload',
      'GET /api/v1/projects/:project',
      'PUT /api/v1/projects/:project',
      'GET /api/v1/projects/:project/public-config',
      'GET /api/v1/contributions',
      'POST /api/v1/contributions',
      'GET /api/v1/contributions/:id',
      'POST /api/v1/contributions/:id/attachments',
      'POST /api/v1/contributions/:id/messages',
      'POST /api/v1/contributions/:id/spec-approval',
      'GET /api/v1/contributions/:id/progress',
      'POST /api/v1/contributions/:id/queue-implementation',
      'POST /api/v1/contributions/:id/pull-requests',
      'POST /api/v1/contributions/:id/preview-deployments',
      'GET /api/v1/contributions/:id/preview-evidence',
      'POST /api/v1/contributions/:id/preview-review',
      'POST /api/v1/contributions/:id/open-voting',
      'POST /api/v1/contributions/:id/flag-core-review',
      'POST /api/v1/contributions/:id/start-core-review',
      'POST /api/v1/contributions/:id/votes',
      'POST /api/v1/contributions/:id/comments',
      'POST /api/v1/contributions/:id/mark-merged',
      'POST /api/v1/contributions/:id/start-production-deploy',
      'POST /api/v1/contributions/:id/complete',
    ],
  );
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
          repositoryFullName: 'customer/orbital-ops',
          defaultBranch: 'trunk',
          previewBaseUrl: 'https://preview.orbital.test',
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
  assert.equal(updateResponse.body.project.runtimeConfig.previewBaseUrl, 'https://preview.orbital.test');
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

test('api server supports delivery evidence, voting, and merged state through the real http runtime', async () => {
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
