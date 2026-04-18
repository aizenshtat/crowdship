import assert from 'node:assert/strict';
import { request } from 'node:http';
import test from 'node:test';

import {
  API_ROUTE_DEFINITIONS,
  CONTRIBUTION_STATES,
  INITIAL_CONTRIBUTION_STATE,
  PROJECT_PUBLIC_CONFIGS,
} from '../src/shared/contracts.js';
import {
  createContributionHandler,
  createContributionProgressHandler,
  createRouteHandlers,
} from '../src/server/routes.js';
import { createInMemoryContributionPersistenceAdapter } from '../src/server/persistence.js';
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
      'POST /api/v1/contributions/:id/attachments',
      'POST /api/v1/contributions/:id/spec-approval',
      'GET /api/v1/contributions/:id/progress',
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

test('contribution creation does not fake success when persistence is missing', () => {
  const createContribution = createContributionHandler();
  const response = createContribution({
    body: {
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
      },
      client: {
        timezone: 'Europe/Vienna',
        locale: 'en-US',
      },
    },
  });

  assert.equal(response.status, 501);
  assert.match(response.body.message, /not wired/i);
  assert.equal('id' in response.body, false);
  assert.equal('contributionId' in response.body, false);
});

test('connected contribution persistence stores a created lifecycle event', () => {
  const ids = ['contribution-123', 'progress-event-456'];
  const persistence = createInMemoryContributionPersistenceAdapter({
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const createContribution = createContributionHandler({
    database: persistence,
    idFactory: () => ids.shift(),
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const response = createContribution({
    body: {
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
      },
      client: {
        timezone: 'Europe/Vienna',
        locale: 'en-US',
      },
    },
  });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body.contribution, {
    id: 'contribution-123',
    projectSlug: 'example',
    environment: 'production',
    type: 'feature_request',
    title: 'Add anomaly replay for signal drops',
    body: 'I need to replay the selected signal drop anomaly from the mission screen.',
    state: INITIAL_CONTRIBUTION_STATE,
    payload: {
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
      },
      client: {
        timezone: 'Europe/Vienna',
        locale: 'en-US',
      },
    },
    createdAt: '2026-04-18T12:00:00.000Z',
    updatedAt: '2026-04-18T12:00:00.000Z',
  });
  assert.equal(response.body.lifecycle.currentState, INITIAL_CONTRIBUTION_STATE);
  assert.deepEqual(response.body.lifecycle.events, [
    {
      id: 'progress-event-456',
      contributionId: 'contribution-123',
      kind: 'created',
      status: INITIAL_CONTRIBUTION_STATE,
      message: 'Contribution created.',
      externalUrl: null,
      payload: {
        contributionId: 'contribution-123',
        projectSlug: 'example',
        environment: 'production',
        type: 'feature_request',
      },
      createdAt: '2026-04-18T12:00:00.000Z',
    },
  ]);

  const progress = createContributionProgressHandler({ database: persistence })({
    params: { id: 'contribution-123' },
  });

  assert.equal(progress.status, 200);
  assert.equal(progress.body.contribution.id, 'contribution-123');
  assert.deepEqual(progress.body.lifecycle.events, response.body.lifecycle.events);
});

test('connected contribution persistence lists created contributions', () => {
  const ids = ['contribution-123', 'progress-event-456', 'contribution-789', 'progress-event-999'];
  const persistence = createInMemoryContributionPersistenceAdapter({
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const createContribution = createContributionHandler({
    database: persistence,
    idFactory: () => ids.shift(),
    clock: () => new Date('2026-04-18T12:00:00Z'),
  });
  const listContributions = createRouteHandlers({ database: persistence }).getContributions;

  createContribution({
    body: {
      project: 'example',
      environment: 'production',
      type: 'feature_request',
      title: 'Add anomaly replay for signal drops',
    },
  });
  createContribution({
    body: {
      project: 'example',
      environment: 'production',
      type: 'bug_report',
      title: 'Fix telemetry context expansion on mobile',
    },
  });

  const response = listContributions();

  assert.equal(response.status, 200);
  assert.equal(response.body.contributions.length, 2);
  assert.equal(response.body.contributions[0].title, 'Add anomaly replay for signal drops');
  assert.equal(response.body.contributions[1].title, 'Fix telemetry context expansion on mobile');
});

test('contribution progress fails safely without persistence', () => {
  const getContributionProgress = createContributionProgressHandler();
  const response = getContributionProgress({
    params: { id: 'contribution-123' },
  });

  assert.equal(response.status, 501);
  assert.match(response.body.message, /not wired/i);
  assert.equal('events' in response.body, false);
});

test('api server persists contributions through the real http runtime', async () => {
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
      body: {
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
        },
        client: {
          timezone: 'Europe/Vienna',
          locale: 'en-US',
        },
      },
    });

    assert.equal(contribution.status, 201);
    assert.equal(contribution.body.contribution.projectSlug, 'example');
    assert.equal(contribution.body.lifecycle.currentState, INITIAL_CONTRIBUTION_STATE);

    const progress = await requestJson({
      port: address.port,
      method: 'GET',
      path: `/api/v1/contributions/${contribution.body.contribution.id}/progress`,
    });

    assert.equal(progress.status, 200);
    assert.equal(progress.body.contribution.id, contribution.body.contribution.id);
    assert.deepEqual(progress.body.lifecycle.events, contribution.body.lifecycle.events);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
