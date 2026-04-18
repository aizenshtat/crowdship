import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildBranchName,
  buildContributionArtifact,
  buildPreviewUrl,
  buildPullRequestBody,
  buildPullRequestTitle,
} from '../src/worker/helpers.js';
import { sanitizeImplementationEdits } from '../src/worker/implementation-service.js';
import { isDirectWorkerRun, processClaimedJob } from '../src/worker/runtime.js';

test('worker builds branch names with contribution id and slugged title', () => {
  assert.equal(
    buildBranchName('ctrb-123', 'Add anomaly replay for signal drops'),
    'crowdship/ctrb-123-add-anomaly-replay-for-signal-drops',
  );
});

test('worker builds preview url under contribution preview path', () => {
  assert.equal(
    buildPreviewUrl('https://example.aizenshtat.eu/', 'ctrb-123'),
    'https://example.aizenshtat.eu/previews/ctrb-123/',
  );
});

test('worker builds real artifact and pr body summaries', () => {
  const detail = {
    contribution: {
      id: 'ctrb-123',
      title: 'Add anomaly replay for signal drops',
      state: 'spec_approved',
      body: 'Replay the signal drop from the mission surface.',
      payload: {
        route: '/mission',
      },
    },
    specVersions: [
      {
        versionNumber: 1,
        goal: 'Add anomaly replay for signal drops.',
        userProblem: 'Replay the signal drop from the mission surface.',
        spec: {
          acceptanceCriteria: ['The replay starts from /mission.'],
          nonGoals: ['Do not redesign the mission console.'],
        },
      },
    ],
  };

  const artifact = buildContributionArtifact(detail);
  const body = buildPullRequestBody({
    contributionId: 'ctrb-123',
    contributionTitle: 'Add anomaly replay for signal drops',
    crowdshipBaseUrl: 'https://crowdship.aizenshtat.eu',
    acceptanceCriteria: ['The replay starts from /mission.'],
    previewUrl: 'https://example.aizenshtat.eu/previews/ctrb-123/',
    verification: ['npm test'],
  });

  assert.match(artifact, /Crowdship Contribution ctrb-123/);
  assert.match(artifact, /The replay starts from \/mission\./);
  assert.equal(buildPullRequestTitle('Add anomaly replay for signal drops'), 'Crowdship: Add anomaly replay for signal drops');
  assert.match(body, /Contribution ID: `ctrb-123`/);
  assert.match(body, /https:\/\/example\.aizenshtat\.eu\/previews\/ctrb-123\//);
  assert.match(body, /npm test/);
});

test('worker only treats the runtime file as a direct entry point', () => {
  const runtimeUrl = new URL('../src/worker/runtime.js', import.meta.url).href;
  const runtimePath = fileURLToPath(runtimeUrl);

  assert.equal(isDirectWorkerRun(runtimePath, runtimeUrl), true);
  assert.equal(isDirectWorkerRun(runtimePath, 'file:///tmp/other.js'), false);
  assert.equal(isDirectWorkerRun(null, runtimeUrl), false);
});

test('implementation edits stay inside the allowed example repo surface', () => {
  const edits = sanitizeImplementationEdits('/tmp/example', [
    {
      path: 'src/App.tsx',
      reason: 'Add the replay gauge panel.',
      content: 'export function App() { return null; }\n',
    },
    {
      path: 'tests/contracts.test.mjs',
      content: 'import test from "node:test";\n',
    },
  ]);

  assert.deepEqual(
    edits.map((edit) => edit.path),
    ['src/App.tsx', 'tests/contracts.test.mjs'],
  );
});

test('implementation edits reject paths outside the allowed example repo surface', () => {
  assert.throws(
    () =>
      sanitizeImplementationEdits('/tmp/example', [
        {
          path: 'docs/contributions/ctrb-123.md',
          content: '# artifact\n',
        },
      ]),
    /outside the allowed repo surface/,
  );
});

test('worker marks implementation jobs failed when setup errors happen before repository work starts', async () => {
  const previousApiKey = process.env.OPENAI_API_KEY;
  const poolCalls = [];
  const progressUpdates = [];

  delete process.env.OPENAI_API_KEY;

  try {
    await processClaimedJob(
      {
        query: async (sql, values) => {
          poolCalls.push({ sql, values });
          return { rows: [] };
        },
      },
      {
        async getContributionDetail() {
          return {
            contribution: {
              id: 'ctrb-setup-failure',
              projectSlug: 'example',
              title: 'Add anomaly replay for signal drops',
            },
            specVersions: [],
          };
        },
        async applyContributionUpdate(payload) {
          progressUpdates.push(payload);
        },
      },
      {
        id: 'job-setup-failure',
        contribution_id: 'ctrb-setup-failure',
        branch_name: null,
        repository_full_name: 'aizenshtat/example',
      },
    );
  } finally {
    if (previousApiKey == null) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousApiKey;
    }
  }

  assert.ok(
    poolCalls.some(({ sql, values }) =>
      /UPDATE implementation_jobs/.test(sql) &&
      Array.isArray(values) &&
      values.includes('failed'),
    ),
  );
  assert.ok(
    progressUpdates.some((payload) => payload.nextState === 'implementation_failed'),
  );
});

test('worker marks implementation jobs failed when contribution detail lookup throws before setup starts', async () => {
  const poolCalls = [];
  const progressUpdates = [];

  await processClaimedJob(
    {
      query: async (sql, values) => {
        poolCalls.push({ sql, values });
        return { rows: [] };
      },
    },
    {
      async getContributionDetail() {
        throw new Error('Detail lookup failed.');
      },
      async applyContributionUpdate(payload) {
        progressUpdates.push(payload);
      },
    },
    {
      id: 'job-detail-lookup-failure',
      contribution_id: 'ctrb-detail-lookup-failure',
      branch_name: null,
      repository_full_name: 'aizenshtat/example',
    },
  );

  assert.ok(
    poolCalls.some(({ sql, values }) =>
      /UPDATE implementation_jobs/.test(sql) &&
      Array.isArray(values) &&
      values.includes('failed'),
    ),
  );
  assert.equal(progressUpdates.length, 0);
});
