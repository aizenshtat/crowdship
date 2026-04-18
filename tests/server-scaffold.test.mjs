import assert from 'node:assert/strict';
import { request } from 'node:http';
import test from 'node:test';

import {
  API_ROUTE_DEFINITIONS,
  CONTRIBUTION_STATES,
  PROJECT_PUBLIC_CONFIGS,
  SPEC_APPROVED_CONTRIBUTION_STATE,
  SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE,
} from '../src/shared/contracts.js';
import {
  createContributionDetailHandler,
  createContributionHandler,
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

test('shared contribution states preserve the lifecycle order', () => {
  assert.deepEqual(CONTRIBUTION_STATES, [
    'draft_chat',
    'spec_pending_approval',
    'spec_approved',
    'agent_queued',
    'agent_running',
    'pr_opened',
    'preview_deploying',
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

test('example public config allows production and localhost development origins', () => {
  const config = PROJECT_PUBLIC_CONFIGS.example;

  assert.equal(config.project, 'example');
  assert.ok(config.allowedOrigins.includes('https://example.aizenshtat.eu'));
  assert.ok(config.allowedOrigins.includes('http://localhost:5173'));
  assert.ok(config.allowedOrigins.includes('http://localhost:4173'));
  assert.ok(config.allowedOrigins.includes('http://127.0.0.1:5173'));
});

test('api route structure includes the required public endpoints', () => {
  assert.deepEqual(
    API_ROUTE_DEFINITIONS.map(({ method, path }) => `${method} ${path}`),
    [
      'GET /api/v1/health',
      'GET /api/v1/projects/:project/public-config',
      'GET /api/v1/contributions',
      'POST /api/v1/contributions',
      'GET /api/v1/contributions/:id',
      'POST /api/v1/contributions/:id/attachments',
      'POST /api/v1/contributions/:id/spec-approval',
      'GET /api/v1/contributions/:id/progress',
      'POST /api/v1/contributions/:id/queue-implementation',
      'POST /api/v1/contributions/:id/pull-requests',
      'POST /api/v1/contributions/:id/preview-deployments',
      'POST /api/v1/contributions/:id/open-voting',
      'POST /api/v1/contributions/:id/votes',
      'POST /api/v1/contributions/:id/comments',
      'POST /api/v1/contributions/:id/mark-merged',
    ],
  );
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

test('connected contribution persistence stores the request, attachment metadata, and first spec version', async () => {
  const ids = [
    'contribution-123',
    'attachment-1',
    'message-1',
    'spec-1',
    'message-2',
    'progress-created',
    'progress-spec',
  ];
  const persistence = createInMemoryContributionPersistenceAdapter({
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const createContribution = createContributionHandler({
    database: persistence,
    idFactory: () => ids.shift(),
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const getContribution = createContributionDetailHandler({ database: persistence });

  const response = await createContribution({
    body: buildCreatePayload(),
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.contribution.id, 'contribution-123');
  assert.equal(response.body.contribution.state, SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE);
  assert.equal(response.body.attachments.length, 1);
  assert.equal(response.body.attachments[0].filename, 'signal-drop-17.csv');
  assert.equal(response.body.conversation.length, 2);
  assert.equal(response.body.spec.current.versionNumber, 1);
  assert.deepEqual(response.body.spec.current.acceptanceCriteria.length > 0, true);
  assert.equal(response.body.lifecycle.events.length, 2);
  assert.equal(response.body.lifecycle.currentState, SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE);

  const detail = await getContribution({
    params: { id: 'contribution-123' },
  });

  assert.equal(detail.status, 200);
  assert.equal(detail.body.spec.current.id, 'spec-1');
  assert.equal(detail.body.conversation[0].authorRole, 'requester');
  assert.equal(detail.body.conversation[1].authorRole, 'agent');
});

test('connected contribution persistence supports refinement and approval', async () => {
  const ids = [
    'contribution-123',
    'attachment-1',
    'message-1',
    'spec-1',
    'message-2',
    'progress-created',
    'progress-spec',
    'message-3',
    'spec-2',
    'message-4',
    'progress-refined',
    'message-5',
    'progress-approved',
  ];
  const persistence = createInMemoryContributionPersistenceAdapter({
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const createContribution = createContributionHandler({
    database: persistence,
    idFactory: () => ids.shift(),
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const specApproval = createSpecApprovalHandler({
    database: persistence,
    idFactory: () => ids.shift(),
    clock: () => new Date('2026-04-18T12:05:00Z'),
  });

  await createContribution({
    body: buildCreatePayload(),
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
  assert.equal(refined.body.conversation.length, 4);

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
    'spec-1',
    'message-2',
    'progress-created',
    'progress-spec',
    'contribution-789',
    'attachment-2',
    'message-3',
    'spec-2',
    'message-4',
    'progress-created-2',
    'progress-spec-2',
  ];
  const persistence = createInMemoryContributionPersistenceAdapter({
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const createContribution = createContributionHandler({
    database: persistence,
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
  assert.equal(response.body.contributions[0].latestSpecVersion, 1);
  assert.equal(response.body.contributions[0].state, SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE);
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
  const server = createApiServer();

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
    assert.equal(contribution.body.lifecycle.currentState, SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE);
    assert.equal(contribution.body.spec.current.versionNumber, 1);

    const detail = await requestJson({
      port: address.port,
      method: 'GET',
      path: `/api/v1/contributions/${contribution.body.contribution.id}`,
    });

    assert.equal(detail.status, 200);
    assert.equal(detail.body.contribution.id, contribution.body.contribution.id);
    assert.equal(detail.body.conversation.length, 2);

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
  const server = createApiServer();

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

    assert.equal(voting.status, 200);
    assert.equal(voting.body.contribution.state, 'voting_open');

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
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
