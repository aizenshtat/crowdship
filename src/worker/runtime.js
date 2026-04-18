import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { Pool } from 'pg';

import { createPostgresContributionPersistenceAdapter } from '../server/persistence.js';
import {
  PREVIEW_READY_CONTRIBUTION_STATE,
  PR_OPENED_CONTRIBUTION_STATE,
} from '../shared/contracts.js';
import {
  buildBranchName,
  buildContributionArtifact,
  buildPreviewUrl,
  buildPullRequestBody,
  buildPullRequestTitle,
} from './helpers.js';

const execFileAsync = promisify(execFile);
const POLL_MS = Number.parseInt(process.env.CROWDSHIP_WORKER_POLL_MS ?? '', 10) || 15000;
const EXAMPLE_REPO_PATH = process.env.EXAMPLE_REPO_PATH || '/root/example';
const EXAMPLE_REPOSITORY_FULL_NAME = process.env.EXAMPLE_REPOSITORY_FULL_NAME || 'aizenshtat/example';
const EXAMPLE_DEFAULT_BRANCH = process.env.EXAMPLE_DEFAULT_BRANCH || 'main';
const EXAMPLE_PREVIEW_DEPLOY_SCRIPT = process.env.EXAMPLE_PREVIEW_DEPLOY_SCRIPT || '/root/example/scripts/deploy-preview.sh';
const CROWDSHIP_BASE_URL = process.env.CROWDSHIP_BASE_URL || 'https://crowdship.aizenshtat.eu';
const EXAMPLE_BASE_URL = process.env.EXAMPLE_BASE_URL || 'https://example.aizenshtat.eu';

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function nowIso() {
  return new Date().toISOString();
}

async function runCommand(command, args, { cwd, env } = {}) {
  const home = process.env.HOME || '/root';
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || join(home, '.config'),
      GH_CONFIG_DIR: process.env.GH_CONFIG_DIR || join(home, '.config', 'gh'),
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'Crowdship Worker',
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'crowdship@example.aizenshtat.eu',
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'Crowdship Worker',
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'crowdship@example.aizenshtat.eu',
      ...env,
    },
  });

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

async function getGithubPushExtraHeader(cwd) {
  const { stdout } = await runCommand('gh', ['auth', 'token'], {
    cwd,
    env: {
      GH_PROMPT_DISABLED: '1',
    },
  });
  const token = stdout.trim();

  if (!token) {
    throw new Error('GitHub CLI authentication token is unavailable for worker push.');
  }

  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  return `AUTHORIZATION: basic ${basic}`;
}

async function claimNextQueuedJob(pool) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const selectResult = await client.query(
      `
        SELECT *
        FROM implementation_jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `,
    );

    if (selectResult.rowCount === 0) {
      await client.query('COMMIT');
      return null;
    }

    const job = selectResult.rows[0];
    const updateResult = await client.query(
      `
        UPDATE implementation_jobs
        SET
          status = 'running',
          started_at = COALESCE(started_at, now())
        WHERE id = $1
        RETURNING *
      `,
      [job.id],
    );
    await client.query('COMMIT');
    return updateResult.rows[0] ?? null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateImplementationJob(pool, jobId, patch) {
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    return;
  }

  const assignments = [];
  const values = [];

  keys.forEach((key, index) => {
    const parameterIndex = index + 2;
    if (key === 'metadata') {
      assignments.push(`${key} = $${parameterIndex}::jsonb`);
      values.push(patch[key] == null ? null : JSON.stringify(patch[key]));
      return;
    }

    assignments.push(`${key} = $${parameterIndex}`);
    values.push(patch[key]);
  });

  await pool.query(
    `
      UPDATE implementation_jobs
      SET ${assignments.join(', ')}
      WHERE id = $1
    `,
    [jobId, ...values],
  );
}

async function emitProgress(database, contributionId, { nextState, kind, message, externalUrl = null, payload = null }) {
  const createdAt = nowIso();
  await database.applyContributionUpdate({
    contributionId,
    nextState,
    updatedAt: createdAt,
    progressEvents: [
      {
        id: globalThis.crypto.randomUUID(),
        contributionId,
        kind,
        status: nextState,
        message,
        externalUrl,
        payload,
        createdAt,
      },
    ],
  });
}

function getProjectRepoConfig(detail, claimedJob) {
  if (detail.contribution.projectSlug === 'example') {
    return {
      repoPath: EXAMPLE_REPO_PATH,
      repositoryFullName: claimedJob.repository_full_name || EXAMPLE_REPOSITORY_FULL_NAME,
      defaultBranch: EXAMPLE_DEFAULT_BRANCH,
      previewDeployScript: EXAMPLE_PREVIEW_DEPLOY_SCRIPT,
      baseUrl: EXAMPLE_BASE_URL,
    };
  }

  throw new Error(`Unsupported project slug for worker automation: ${detail.contribution.projectSlug}`);
}

async function ensureWorktree(repoPath, branchName, defaultBranch, worktreePath) {
  rmSync(worktreePath, { recursive: true, force: true });
  const remoteExists = await runCommand('git', ['ls-remote', '--heads', 'origin', branchName], {
    cwd: repoPath,
  });

  if (remoteExists.stdout) {
    await runCommand('git', ['fetch', 'origin', `${branchName}:${branchName}`], {
      cwd: repoPath,
    });
    await runCommand('git', ['worktree', 'add', worktreePath, branchName], {
      cwd: repoPath,
    });
    return;
  }

  await runCommand('git', ['worktree', 'add', '-b', branchName, worktreePath, `origin/${defaultBranch}`], {
    cwd: repoPath,
  });
}

async function prepareWorktreeDependencies(worktreePath) {
  if (!existsSync(join(worktreePath, 'package.json'))) {
    return null;
  }

  const installArgs = existsSync(join(worktreePath, 'package-lock.json'))
    ? ['ci', '--include=dev']
    : ['install', '--include=dev'];
  await runCommand('npm', installArgs, {
    cwd: worktreePath,
  });

  return `npm ${installArgs.join(' ')}`;
}

async function commitContributionArtifact(worktreePath, contributionId, detail) {
  const artifactPath = join(worktreePath, 'docs', 'contributions', `${contributionId}.md`);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, buildContributionArtifact(detail), 'utf8');

  await runCommand('git', ['add', relative(worktreePath, artifactPath)], {
    cwd: worktreePath,
  });

  const status = await runCommand('git', ['status', '--short'], {
    cwd: worktreePath,
  });

  if (!status.stdout) {
    return false;
  }

  await runCommand('git', ['commit', '--no-verify', '-m', buildPullRequestTitle(detail.contribution.title)], {
    cwd: worktreePath,
  });
  return true;
}

async function ensureBranchPushed(worktreePath, branchName) {
  const extraHeader = await getGithubPushExtraHeader(worktreePath);
  await runCommand(
    'git',
    ['-c', `http.https://github.com/.extraheader=${extraHeader}`, 'push', '-u', 'origin', branchName],
    {
      cwd: worktreePath,
    },
  );
}

async function runVerification(worktreePath) {
  const commands = [
    ['npm', ['test']],
    ['npm', ['run', 'build']],
  ];
  const completed = [];

  for (const [command, args] of commands) {
    await runCommand(command, args, { cwd: worktreePath });
    completed.push(`${command} ${args.join(' ')}`.trim());
  }

  return completed;
}

async function ensurePullRequest(
  worktreePath,
  repositoryFullName,
  baseBranch,
  branchName,
  detail,
  verification,
  previewUrl = null,
) {
  const existing = await runCommand(
    'gh',
    ['pr', 'list', '--repo', repositoryFullName, '--head', branchName, '--state', 'open', '--json', 'number,url'],
    { cwd: worktreePath },
  );
  const existingPullRequests = existing.stdout ? JSON.parse(existing.stdout) : [];

  if (existingPullRequests[0]) {
    return {
      number: existingPullRequests[0].number,
      url: existingPullRequests[0].url,
      created: false,
    };
  }

  const latestSpec = detail.specVersions
    .slice()
    .sort((left, right) => right.versionNumber - left.versionNumber)[0];
  const bodyPath = join(worktreePath, '.crowdship-pr-body.md');
  writeFileSync(
    bodyPath,
    buildPullRequestBody({
      contributionId: detail.contribution.id,
      contributionTitle: detail.contribution.title,
      crowdshipBaseUrl: CROWDSHIP_BASE_URL,
      acceptanceCriteria: latestSpec?.spec?.acceptanceCriteria ?? [],
      previewUrl,
      verification,
    }),
    'utf8',
  );

  const created = await runCommand(
    'gh',
    [
      'pr',
      'create',
      '--repo',
      repositoryFullName,
      '--draft',
      '--base',
      baseBranch,
      '--head',
      branchName,
      '--title',
      buildPullRequestTitle(detail.contribution.title),
      '--body-file',
      bodyPath,
    ],
    { cwd: worktreePath },
  );

  return {
    number: Number.parseInt(created.stdout.split('/').pop() ?? '', 10) || 0,
    url: created.stdout.trim(),
    created: true,
  };
}

async function deployPreviewIfConfigured(contributionId, repoPath) {
  if (!existsSync(EXAMPLE_PREVIEW_DEPLOY_SCRIPT)) {
    return null;
  }

  await runCommand('bash', [EXAMPLE_PREVIEW_DEPLOY_SCRIPT, contributionId, repoPath], {
    cwd: repoPath,
  });

  const previewUrl = buildPreviewUrl(EXAMPLE_BASE_URL, contributionId);
  const response = await fetch(previewUrl, {
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Preview deploy did not respond cleanly: ${response.status}`);
  }

  return previewUrl;
}

async function processClaimedJob(pool, database, claimedJob) {
  const detail = await database.getContributionDetail(claimedJob.contribution_id);

  if (!detail) {
    await updateImplementationJob(pool, claimedJob.id, {
      status: 'failed',
      finished_at: nowIso(),
      error_summary: 'Contribution detail could not be loaded.',
    });
    return;
  }

  const repo = getProjectRepoConfig(detail, claimedJob);
  if (!existsSync(repo.repoPath)) {
    throw new Error(`Target repository path does not exist: ${repo.repoPath}`);
  }
  const branchName =
    claimedJob.branch_name || buildBranchName(detail.contribution.id, detail.contribution.title);
  const worktreePath = join(tmpdir(), `crowdship-${detail.contribution.id}`);
  const verification = [];

  try {
    await emitProgress(database, detail.contribution.id, {
      nextState: 'agent_running',
      kind: 'agent_step',
      message: 'Inspecting target repository.',
      payload: {
        contributionId: detail.contribution.id,
        branchName,
        repositoryFullName: repo.repositoryFullName,
      },
    });
    await ensureWorktree(repo.repoPath, branchName, repo.defaultBranch, worktreePath);
    await updateImplementationJob(pool, claimedJob.id, {
      branch_name: branchName,
      repository_full_name: repo.repositoryFullName,
    });

    await emitProgress(database, detail.contribution.id, {
      nextState: 'agent_running',
      kind: 'agent_step',
      message: 'Preparing repository dependencies.',
      payload: {
        contributionId: detail.contribution.id,
        branchName,
      },
    });
    const installCommand = await prepareWorktreeDependencies(worktreePath);
    if (installCommand) {
      verification.push(installCommand);
    }

    await emitProgress(database, detail.contribution.id, {
      nextState: 'agent_running',
      kind: 'agent_step',
      message: 'Writing approved spec artifact into the repository.',
      payload: {
        contributionId: detail.contribution.id,
        branchName,
      },
    });
    await commitContributionArtifact(worktreePath, detail.contribution.id, detail);

    await emitProgress(database, detail.contribution.id, {
      nextState: 'agent_running',
      kind: 'verification_started',
      message: 'Running repository verification.',
      payload: {
        contributionId: detail.contribution.id,
      },
    });
    verification.push(...(await runVerification(worktreePath)));

    await emitProgress(database, detail.contribution.id, {
      nextState: 'agent_running',
      kind: 'verification_finished',
      message: 'Repository verification passed.',
      payload: {
        contributionId: detail.contribution.id,
        commands: verification,
      },
    });

    await ensureBranchPushed(worktreePath, branchName);
    await emitProgress(database, detail.contribution.id, {
      nextState: 'agent_running',
      kind: 'branch_pushed',
      message: 'Branch pushed to GitHub.',
      payload: {
        contributionId: detail.contribution.id,
        branchName,
      },
    });

    const previewUrl = await deployPreviewIfConfigured(detail.contribution.id, repo.repoPath);
    const pullRequest = await ensurePullRequest(
      worktreePath,
      repo.repositoryFullName,
      repo.defaultBranch,
      branchName,
      detail,
      verification,
      previewUrl,
    );

    const prRecordedAt = nowIso();
    await database.applyContributionUpdate({
      contributionId: detail.contribution.id,
      nextState: PR_OPENED_CONTRIBUTION_STATE,
      updatedAt: prRecordedAt,
      pullRequests: [
        {
          id: globalThis.crypto.randomUUID(),
          contributionId: detail.contribution.id,
          repositoryFullName: repo.repositoryFullName,
          number: pullRequest.number,
          url: pullRequest.url,
          branchName,
          headSha: null,
          status: 'open',
          metadata: {
            verification,
          },
          createdAt: prRecordedAt,
          updatedAt: prRecordedAt,
        },
      ],
      progressEvents: [
        {
          id: globalThis.crypto.randomUUID(),
          contributionId: detail.contribution.id,
          kind: 'pr_opened',
          status: PR_OPENED_CONTRIBUTION_STATE,
          message: `PR #${pullRequest.number} opened.`,
          externalUrl: pullRequest.url,
          payload: {
            contributionId: detail.contribution.id,
            branchName,
            repositoryFullName: repo.repositoryFullName,
            number: pullRequest.number,
          },
          createdAt: prRecordedAt,
        },
      ],
    });

    if (previewUrl) {
      const previewRecordedAt = nowIso();
      await database.applyContributionUpdate({
        contributionId: detail.contribution.id,
        nextState: PREVIEW_READY_CONTRIBUTION_STATE,
        updatedAt: previewRecordedAt,
        previewDeployments: [
          {
            id: globalThis.crypto.randomUUID(),
            contributionId: detail.contribution.id,
            pullRequestId: null,
            url: previewUrl,
            status: 'ready',
            gitSha: null,
            deployKind: 'branch_preview',
            deployedAt: previewRecordedAt,
            checkedAt: previewRecordedAt,
            errorSummary: null,
            metadata: {
              branchName,
              verification,
            },
            createdAt: previewRecordedAt,
          },
        ],
        progressEvents: [
          {
            id: globalThis.crypto.randomUUID(),
            contributionId: detail.contribution.id,
            kind: 'preview_ready',
            status: PREVIEW_READY_CONTRIBUTION_STATE,
            message: 'Preview deployed.',
            externalUrl: previewUrl,
            payload: {
              contributionId: detail.contribution.id,
              previewUrl,
            },
            createdAt: previewRecordedAt,
          },
        ],
      });
    }

    await updateImplementationJob(pool, claimedJob.id, {
      status: 'completed',
      finished_at: nowIso(),
      error_summary: null,
      metadata: {
        verification,
        branchName,
        previewUrl,
      },
    });
  } catch (error) {
    await updateImplementationJob(pool, claimedJob.id, {
      status: 'failed',
      finished_at: nowIso(),
      error_summary: error instanceof Error ? error.message.slice(0, 500) : 'Worker execution failed.',
    });

    await emitProgress(database, detail.contribution.id, {
      nextState: detail.contribution.state,
      kind: 'agent_step',
      message: error instanceof Error ? `Worker failed: ${error.message}` : 'Worker failed.',
      payload: {
        contributionId: detail.contribution.id,
      },
    });
  } finally {
    if (existsSync(worktreePath)) {
      try {
        await runCommand('git', ['worktree', 'remove', '--force', worktreePath], {
          cwd: repo.repoPath,
        });
      } catch {
        rmSync(worktreePath, { recursive: true, force: true });
      }
    }
  }
}

export async function runWorkerOnce() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for the Crowdship worker.');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const database = createPostgresContributionPersistenceAdapter({
    pool,
  });

  try {
    const claimedJob = await claimNextQueuedJob(pool);

    if (!claimedJob) {
      return false;
    }

    await processClaimedJob(pool, database, claimedJob);
    return true;
  } finally {
    await database.close();
  }
}

export async function startWorkerLoop() {
  process.stdout.write(`crowdship worker polling every ${POLL_MS}ms\n`);

  for (;;) {
    try {
      const processed = await runWorkerOnce();
      if (!processed) {
        await sleep(POLL_MS);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`crowdship worker error: ${message}\n`);
      await sleep(POLL_MS);
    }
  }
}

export function isDirectWorkerRun(argv1 = process.argv[1], metaUrl = import.meta.url) {
  if (!argv1) {
    return false;
  }

  return resolve(fileURLToPath(metaUrl)) === resolve(argv1);
}

const isDirectRun = isDirectWorkerRun();

if (isDirectRun) {
  if (process.env.CROWDSHIP_WORKER_ONCE === '1') {
    const processed = await runWorkerOnce();
    process.stdout.write(processed ? 'crowdship worker processed one job\n' : 'crowdship worker found no queued job\n');
  } else {
    await startWorkerLoop();
  }
}
