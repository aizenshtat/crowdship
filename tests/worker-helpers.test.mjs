import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildBranchName,
  buildContributionArtifact,
  buildPreviewUrl,
  buildPullRequestBody,
  buildPullRequestTitle,
} from '../src/worker/helpers.js';
import {
  createOpenAiImplementationService,
  resolveImplementationProfile,
  sanitizeImplementationEdits,
  writeImplementationEdits,
} from '../src/worker/implementation-service.js';
import {
  __testInternals,
  isDirectWorkerRun,
  processClaimedJob,
  resolvePreviewDeployScriptPath,
  resolveRepositoryWorkspaceConfig,
} from '../src/worker/runtime.js';

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

test('worker resolves hosted github clone mode when no local repo path is configured', () => {
  const resolved = resolveRepositoryWorkspaceConfig(
    {
      contribution: {
        projectSlug: 'orbital-ops',
      },
    },
    {
      repository_full_name: 'customer/orbital-ops',
      metadata: {
        projectRuntimeConfig: {
          executionMode: 'hosted',
          repositoryFullName: 'customer/orbital-ops',
          defaultBranch: 'main',
        },
      },
    },
  );

  assert.equal(resolved.checkoutMode, 'github_clone');
  assert.equal(resolved.repoPath, null);
  assert.equal(resolved.repositoryCloneUrl, 'https://github.com/customer/orbital-ops.git');
});

test('worker keeps local checkout mode for self-hosted execution with a repo path', () => {
  const resolved = resolveRepositoryWorkspaceConfig(
    {
      contribution: {
        projectSlug: 'orbital-ops',
      },
    },
    {
      repository_full_name: 'customer/orbital-ops',
      metadata: {
        projectRuntimeConfig: {
          executionMode: 'self_hosted',
          repositoryFullName: 'customer/orbital-ops',
          repoPath: '/srv/customer/orbital-ops',
          defaultBranch: 'main',
        },
      },
    },
  );

  assert.equal(resolved.checkoutMode, 'local_path');
  assert.equal(resolved.repoPath, '/srv/customer/orbital-ops');
});

test('worker ignores repoPath in hosted remote-clone mode and clones from GitHub instead', () => {
  const resolved = resolveRepositoryWorkspaceConfig(
    {
      contribution: {
        projectSlug: 'orbital-ops',
      },
    },
    {
      repository_full_name: 'customer/orbital-ops',
      metadata: {
        projectRuntimeConfig: {
          executionMode: 'hosted_remote_clone',
          repositoryFullName: 'customer/orbital-ops',
          repoPath: '/srv/customer/orbital-ops',
          defaultBranch: 'main',
        },
      },
    },
  );

  assert.equal(resolved.executionMode, 'hosted_remote_clone');
  assert.equal(resolved.checkoutMode, 'github_clone');
  assert.equal(resolved.repoPath, null);
  assert.equal(resolved.repositoryCloneUrl, 'https://github.com/customer/orbital-ops.git');
});

test('worker prefers github app repository auth when app credentials are configured', async () => {
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const commands = [];

  process.env.GITHUB_APP_ID = '12345';
  process.env.GITHUB_APP_PRIVATE_KEY = generateKeyPairSync('rsa', {
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

  try {
    const auth = await __testInternals.resolveRepositoryAuth(
      {
        repositoryFullName: 'customer/orbital-ops',
      },
      {
        cwd: '/tmp',
        async runCommandImpl(command, args) {
          commands.push({ command, args });
          return {
            stdout: 'ghp_fallback',
            stderr: '',
          };
        },
        async fetchImpl(url) {
          if (url.endsWith('/repos/customer/orbital-ops/installation')) {
            return new Response(
              JSON.stringify({
                id: 77,
                repository_selection: 'selected',
              }),
              {
                status: 200,
                headers: {
                  'content-type': 'application/json',
                },
              },
            );
          }

          if (url.endsWith('/app/installations/77/access_tokens')) {
            return new Response(
              JSON.stringify({
                token: 'ghs_repo_access',
                expires_at: '2026-04-20T13:00:00Z',
              }),
              {
                status: 201,
                headers: {
                  'content-type': 'application/json',
                },
              },
            );
          }

          throw new Error(`Unexpected fetch request: ${url}`);
        },
      },
    );

    assert.equal(auth.source, 'github_app');
    assert.equal(auth.token, 'ghs_repo_access');
    assert.equal(auth.installationId, 77);
    assert.equal(commands.length, 0);
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

test('worker resolves relative preview deploy scripts against the checked out repository', () => {
  assert.equal(
    resolvePreviewDeployScriptPath(
      {
        previewDeployScript: 'scripts/deploy-preview.sh',
      },
      '/tmp/crowdship-ctrb-123',
    ),
    '/tmp/crowdship-ctrb-123/scripts/deploy-preview.sh',
  );
  assert.equal(
    resolvePreviewDeployScriptPath(
      {
        previewDeployScript: '/srv/bin/deploy-preview.sh',
      },
      '/tmp/crowdship-ctrb-123',
    ),
    '/srv/bin/deploy-preview.sh',
  );
});

test('example keeps the legacy default implementation profile', () => {
  const profile = resolveImplementationProfile({
    contribution: {
      projectSlug: 'example',
    },
  });

  assert.equal(profile.id, 'orbital_ops_reference');
});

test('non-example projects require an explicit implementation profile', () => {
  assert.throws(
    () =>
      resolveImplementationProfile({
        contribution: {
          projectSlug: 'customer-app',
        },
      }),
    /runtimeConfig\.implementationProfile/,
  );
});

test('worker refreshes an existing pull request instead of creating another one', async () => {
  const commands = [];
  const writes = [];

  const detail = {
    contribution: {
      id: 'ctrb-123',
      title: 'Add anomaly replay for signal drops',
    },
    specVersions: [
      {
        versionNumber: 2,
        spec: {
          acceptanceCriteria: ['Replay starts from the selected anomaly row.'],
        },
      },
    ],
  };

  const result = await __testInternals.ensurePullRequest(
    '/tmp/crowdship-ctrb-123',
    'customer/orbital-ops',
    'main',
    'crowdship/ctrb-123-add-anomaly-replay-for-signal-drops',
    detail,
    ['npm test'],
    'https://preview.orbital.test/previews/ctrb-123/',
    {
      auth: {
        token: 'ghs_repo_access',
      },
      async runCommandImpl(command, args, options) {
        commands.push({ command, args, options });

        if (command === 'gh' && args[0] === 'pr' && args[1] === 'list') {
          return {
            stdout: JSON.stringify([
              {
                number: 42,
                url: 'https://github.com/customer/orbital-ops/pull/42',
              },
            ]),
          };
        }

        if (command === 'gh' && args[0] === 'pr' && args[1] === 'edit') {
          return {
            stdout: '',
          };
        }

        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
      },
      writeFileSyncImpl(path, content, encoding) {
        writes.push({ path, content, encoding });
      },
    },
  );

  assert.deepEqual(result, {
    number: 42,
    url: 'https://github.com/customer/orbital-ops/pull/42',
    created: false,
  });
  assert.equal(commands.length, 2);
  assert.equal(commands[0].command, 'gh');
  assert.deepEqual(commands[0].args.slice(0, 2), ['pr', 'list']);
  assert.equal(commands[0].options.env.GH_TOKEN, 'ghs_repo_access');
  assert.equal(commands[1].command, 'gh');
  assert.deepEqual(commands[1].args.slice(0, 2), ['pr', 'edit']);
  assert.equal(commands[1].options.env.GITHUB_TOKEN, 'ghs_repo_access');
  assert.ok(commands[1].args.includes('--body-file'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].encoding, 'utf8');
  assert.match(writes[0].path, /\.crowdship-pr-body\.md$/);
  assert.match(writes[0].content, /Contribution ID: `ctrb-123`/);
  assert.match(writes[0].content, /https:\/\/preview\.orbital\.test\/previews\/ctrb-123\//);
});

test('implementation service supports the react_vite_app profile for non-example repos', async () => {
  const worktreePath = mkdtempSync(join(tmpdir(), 'crowdship-react-vite-profile-'));
  mkdirSync(join(worktreePath, 'src'), { recursive: true });
  writeFileSync(join(worktreePath, 'package.json'), '{"name":"customer-app"}\n', 'utf8');
  writeFileSync(join(worktreePath, 'src/App.tsx'), 'export function App() { return null; }\n', 'utf8');

  const requests = [];
  const service = createOpenAiImplementationService({
    apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: 'submit_repo_edits',
                      arguments: JSON.stringify({
                        summary: 'Updated the customer app.',
                        files: [
                          {
                            path: 'src/App.tsx',
                            content: 'export function App() { return "ready"; }\n',
                          },
                        ],
                      }),
                    },
                  },
                ],
              },
            },
          ],
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

  const detail = {
    contribution: {
      id: 'ctrb-456',
      projectSlug: 'customer-app',
      title: 'Add anomaly replay',
      payload: {},
    },
    attachments: [],
    specVersions: [],
  };

  const result = await service.generateChanges({
    detail,
    worktreePath,
    runtimeConfig: {
      implementationProfile: 'react_vite_app',
    },
  });

  assert.equal(result.summary, 'Updated the customer app.');
  assert.equal(result.files[0].path, 'src/App.tsx');
  const payload = JSON.parse(requests[0].messages[1].content).implementationRequest;
  assert.equal(payload.repository.profile, 'react_vite_app');
  assert.equal(payload.repository.runtime, 'React + TypeScript + Vite');
  assert.deepEqual(payload.repository.allowedFilePrefixes, ['package.json', 'src/', 'tests/', 'public/']);
});

test('writeImplementationEdits respects custom profile allowlists', () => {
  const worktreePath = mkdtempSync(join(tmpdir(), 'crowdship-write-profile-'));

  const written = writeImplementationEdits(
    worktreePath,
    [
      {
        path: 'src/App.tsx',
        content: 'export function App() { return "ready"; }\n',
      },
    ],
    {
      allowedPrefixes: ['src/'],
    },
  );

  assert.deepEqual(written, [
    {
      path: 'src/App.tsx',
      reason: 'Approved spec implementation update',
    },
  ]);
  assert.equal(readFileSync(join(worktreePath, 'src/App.tsx'), 'utf8'), 'export function App() { return "ready"; }\n');
  assert.throws(
    () =>
      writeImplementationEdits(
        worktreePath,
        [
          {
            path: 'docs/runbook.md',
            content: '# no\n',
          },
        ],
        {
          allowedPrefixes: ['src/'],
        },
      ),
    /outside the allowed repo surface/,
  );
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
