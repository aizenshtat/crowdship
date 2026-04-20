import { execFile } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { Pool } from 'pg';

import { createPostgresContributionPersistenceAdapter } from '../server/persistence.js';
import {
  IMPLEMENTATION_FAILED_CONTRIBUTION_STATE,
  PREVIEW_READY_CONTRIBUTION_STATE,
  PR_OPENED_CONTRIBUTION_STATE,
} from '../shared/contracts.js';
import {
  buildBranchName,
  buildPreviewUrl,
  buildPullRequestBody,
  buildPullRequestTitle,
} from './helpers.js';
import {
  createConfiguredImplementationService,
  resolveImplementationProfile,
  writeImplementationEdits,
} from './implementation-service.js';

const execFileAsync = promisify(execFile);
const POLL_MS = Number.parseInt(process.env.CROWDSHIP_WORKER_POLL_MS ?? '', 10) || 15000;
const EXAMPLE_REPO_PATH = process.env.EXAMPLE_REPO_PATH || '/root/example';
const EXAMPLE_REPOSITORY_FULL_NAME = process.env.EXAMPLE_REPOSITORY_FULL_NAME || 'aizenshtat/example';
const EXAMPLE_DEFAULT_BRANCH = process.env.EXAMPLE_DEFAULT_BRANCH || 'main';
const EXAMPLE_PREVIEW_DEPLOY_SCRIPT = process.env.EXAMPLE_PREVIEW_DEPLOY_SCRIPT || '/root/example/scripts/deploy-preview.sh';
const CROWDSHIP_BASE_URL = process.env.CROWDSHIP_BASE_URL || 'https://crowdship.aizenshtat.eu';
const EXAMPLE_BASE_URL = process.env.EXAMPLE_BASE_URL || 'https://example.aizenshtat.eu';
const GITHUB_HTTPS_ORIGIN = 'https://github.com';
const GITHUB_EXTRAHEADER_CONFIG_KEY = 'http.https://github.com/.extraheader';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

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

function buildGithubExtraHeader(token) {
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  return `AUTHORIZATION: basic ${basic}`;
}

function withGithubExtraHeader(args, extraHeader) {
  if (!extraHeader) {
    return [...args];
  }

  return ['-c', `${GITHUB_EXTRAHEADER_CONFIG_KEY}=${extraHeader}`, ...args];
}

async function getGithubPushExtraHeader(cwd, runCommandImpl = runCommand) {
  const { stdout } = await runCommandImpl('gh', ['auth', 'token'], {
    cwd,
    env: {
      GH_PROMPT_DISABLED: '1',
    },
  });
  const token = stdout.trim();

  if (!token) {
    throw new Error('GitHub CLI authentication token is unavailable for worker push.');
  }

  return buildGithubExtraHeader(token);
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

function buildLegacyExampleRuntimeConfig(claimedJob) {
  return {
    executionMode: 'hosted',
    automationPolicy: 'hosted_example',
    repositoryFullName:
      normalizeOptionalString(claimedJob.repository_full_name) || EXAMPLE_REPOSITORY_FULL_NAME,
    repoPath: EXAMPLE_REPO_PATH,
    defaultBranch: EXAMPLE_DEFAULT_BRANCH,
    previewDeployScript: EXAMPLE_PREVIEW_DEPLOY_SCRIPT,
    previewBaseUrl: EXAMPLE_BASE_URL,
    previewUrlPattern: `${EXAMPLE_BASE_URL.replace(/\/+$/, '')}/previews/{contributionId}/`,
    productionBaseUrl: EXAMPLE_BASE_URL,
  };
}

function getProjectRepoConfig(detail, claimedJob) {
  const snapshot = claimedJob?.metadata?.projectRuntimeConfig;

  if (isPlainObject(snapshot)) {
    return {
      ...structuredClone(snapshot),
      repositoryFullName:
        normalizeOptionalString(snapshot.repositoryFullName) ||
        normalizeOptionalString(claimedJob.repository_full_name),
      repoPath: normalizeOptionalString(snapshot.repoPath),
      defaultBranch: normalizeOptionalString(snapshot.defaultBranch),
      previewDeployScript: normalizeOptionalString(snapshot.previewDeployScript),
      previewBaseUrl:
        normalizeOptionalString(snapshot.previewBaseUrl) ||
        normalizeOptionalString(snapshot.productionBaseUrl),
      previewUrlPattern: normalizeOptionalString(snapshot.previewUrlPattern),
      productionBaseUrl: normalizeOptionalString(snapshot.productionBaseUrl),
    };
  }

  if (detail.contribution.projectSlug === 'example') {
    return buildLegacyExampleRuntimeConfig(claimedJob);
  }

  throw new Error(`Unsupported project slug for worker automation: ${detail.contribution.projectSlug}`);
}

function buildGithubRepositoryCloneUrl(repositoryFullName) {
  const normalizedRepositoryFullName = normalizeOptionalString(repositoryFullName);
  if (!normalizedRepositoryFullName) {
    return null;
  }

  return `${GITHUB_HTTPS_ORIGIN}/${normalizedRepositoryFullName}.git`;
}

export function resolveRepositoryWorkspaceConfig(detail, claimedJob) {
  const repo = getProjectRepoConfig(detail, claimedJob);
  const repositoryFullName = normalizeOptionalString(repo.repositoryFullName);
  const repoPath = normalizeOptionalString(repo.repoPath);
  const defaultBranch = normalizeOptionalString(repo.defaultBranch);
  const repositoryCloneUrl =
    normalizeOptionalString(repo.repositoryCloneUrl) || buildGithubRepositoryCloneUrl(repositoryFullName);

  return {
    ...repo,
    repositoryFullName,
    repoPath,
    defaultBranch,
    repositoryCloneUrl,
    checkoutMode: repoPath ? 'local_path' : repositoryCloneUrl ? 'github_clone' : 'unconfigured',
  };
}

function buildResolvedPreviewUrl(runtimeConfig, contributionId) {
  const previewUrlPattern = normalizeOptionalString(runtimeConfig.previewUrlPattern);

  if (previewUrlPattern) {
    return previewUrlPattern.replaceAll('{contributionId}', encodeURIComponent(contributionId));
  }

  const previewBaseUrl =
    normalizeOptionalString(runtimeConfig.previewBaseUrl) ||
    normalizeOptionalString(runtimeConfig.productionBaseUrl);

  if (!previewBaseUrl) {
    return null;
  }

  return buildPreviewUrl(previewBaseUrl, contributionId);
}

async function ensureLocalWorktree(
  repoPath,
  branchName,
  defaultBranch,
  worktreePath,
  { extraHeader, runCommandImpl = runCommand, rmSyncImpl = rmSync } = {},
) {
  rmSyncImpl(worktreePath, { recursive: true, force: true });
  const remoteExists = await runCommandImpl(
    'git',
    withGithubExtraHeader(['ls-remote', '--heads', 'origin', branchName], extraHeader),
    {
      cwd: repoPath,
    },
  );

  if (remoteExists.stdout) {
    await runCommandImpl('git', withGithubExtraHeader(['fetch', 'origin', `${branchName}:${branchName}`], extraHeader), {
      cwd: repoPath,
    });
    await runCommandImpl('git', ['worktree', 'add', worktreePath, branchName], {
      cwd: repoPath,
    });
    return;
  }

  await runCommandImpl('git', ['worktree', 'add', '-b', branchName, worktreePath, `origin/${defaultBranch}`], {
    cwd: repoPath,
  });
}

async function cloneHostedRepository(
  repositoryCloneUrl,
  branchName,
  defaultBranch,
  worktreePath,
  { extraHeader, runCommandImpl = runCommand, rmSyncImpl = rmSync } = {},
) {
  rmSyncImpl(worktreePath, { recursive: true, force: true });
  await runCommandImpl(
    'git',
    withGithubExtraHeader(
      ['clone', '--origin', 'origin', '--branch', defaultBranch, repositoryCloneUrl, worktreePath],
      extraHeader,
    ),
  );

  const remoteExists = await runCommandImpl(
    'git',
    withGithubExtraHeader(['ls-remote', '--heads', 'origin', branchName], extraHeader),
    {
      cwd: worktreePath,
    },
  );

  if (remoteExists.stdout) {
    await runCommandImpl(
      'git',
      withGithubExtraHeader(['fetch', 'origin', `${branchName}:${branchName}`], extraHeader),
      {
        cwd: worktreePath,
      },
    );
    await runCommandImpl('git', ['checkout', branchName], {
      cwd: worktreePath,
    });
    return;
  }

  await runCommandImpl('git', ['checkout', '-b', branchName], {
    cwd: worktreePath,
  });
}

async function ensureRepositoryCheckout(
  repo,
  branchName,
  worktreePath,
  { runCommandImpl = runCommand, rmSyncImpl = rmSync } = {},
) {
  const extraHeader = await getGithubPushExtraHeader(repo.repoPath || undefined, runCommandImpl);

  if (repo.repoPath) {
    await ensureLocalWorktree(repo.repoPath, branchName, repo.defaultBranch, worktreePath, {
      extraHeader,
      runCommandImpl,
      rmSyncImpl,
    });
    return {
      cleanupKind: 'worktree',
      cleanupCwd: repo.repoPath,
      worktreePath,
    };
  }

  await cloneHostedRepository(repo.repositoryCloneUrl, branchName, repo.defaultBranch, worktreePath, {
    extraHeader,
    runCommandImpl,
    rmSyncImpl,
  });
  return {
    cleanupKind: 'directory',
    cleanupCwd: null,
    worktreePath,
  };
}

async function cleanupRepositoryCheckout(
  checkout,
  worktreePath,
  { runCommandImpl = runCommand, existsSyncImpl = existsSync, rmSyncImpl = rmSync } = {},
) {
  if (!worktreePath || !existsSyncImpl(worktreePath)) {
    return;
  }

  if (!checkout || checkout.cleanupKind !== 'worktree' || !checkout.cleanupCwd) {
    rmSyncImpl(worktreePath, { recursive: true, force: true });
    return;
  }

  try {
    await runCommandImpl('git', ['worktree', 'remove', '--force', worktreePath], {
      cwd: checkout.cleanupCwd,
    });
  } catch {
    rmSyncImpl(worktreePath, { recursive: true, force: true });
  }
}

export function resolvePreviewDeployScriptPath(runtimeConfig, repoPath) {
  const previewDeployScript = normalizeOptionalString(runtimeConfig.previewDeployScript);

  if (!previewDeployScript) {
    return null;
  }

  if (isAbsolute(previewDeployScript)) {
    return previewDeployScript;
  }

  return resolve(repoPath, previewDeployScript);
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

async function commitWorktreeChanges(worktreePath, detail) {
  await runCommand('git', ['add', '--all'], {
    cwd: worktreePath,
  });

  const status = await runCommand('git', ['status', '--short'], {
    cwd: worktreePath,
  });

  if (!status.stdout) {
    throw new Error('Implementation worker produced no repository changes.');
  }

  await runCommand('git', ['commit', '--no-verify', '-m', buildPullRequestTitle(detail.contribution.title)], {
    cwd: worktreePath,
  });
}

async function ensureBranchPushed(worktreePath, branchName) {
  const extraHeader = await getGithubPushExtraHeader(worktreePath);
  await runCommand('git', withGithubExtraHeader(['push', '-u', 'origin', branchName], extraHeader), {
    cwd: worktreePath,
  });
}

async function runVerification(worktreePath) {
  const commands = [
    ['npm', ['test']],
    ['npm', ['run', 'build']],
  ];
  const completed = [];

  for (const [command, args] of commands) {
    try {
      await runCommand(command, args, { cwd: worktreePath });
    } catch (error) {
      const stdout = error && typeof error.stdout === 'string' ? error.stdout.trim() : '';
      const stderr = error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
      const commandLabel = `${command} ${args.join(' ')}`.trim();
      const failureMessage = [stdout, stderr].filter(Boolean).join('\n\n').trim();
      const verificationError = new Error(
        failureMessage
          ? `Verification failed for ${commandLabel}.\n\n${failureMessage}`
          : `Verification failed for ${commandLabel}.`,
      );
      verificationError.name = 'VerificationError';
      verificationError.command = commandLabel;
      verificationError.stdout = stdout;
      verificationError.stderr = stderr;
      throw verificationError;
    }
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
  { runCommandImpl = runCommand, writeFileSyncImpl = writeFileSync } = {},
) {
  const existing = await runCommandImpl(
    'gh',
    ['pr', 'list', '--repo', repositoryFullName, '--head', branchName, '--state', 'open', '--json', 'number,url'],
    { cwd: worktreePath },
  );
  const existingPullRequests = existing.stdout ? JSON.parse(existing.stdout) : [];

  const latestSpec = detail.specVersions
    .slice()
    .sort((left, right) => right.versionNumber - left.versionNumber)[0];
  const bodyPath = join(worktreePath, '.crowdship-pr-body.md');
  const pullRequestTitle = buildPullRequestTitle(detail.contribution.title);

  writeFileSyncImpl(
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

  if (existingPullRequests[0]) {
    await runCommandImpl(
      'gh',
      [
        'pr',
        'edit',
        String(existingPullRequests[0].number),
        '--repo',
        repositoryFullName,
        '--title',
        pullRequestTitle,
        '--body-file',
        bodyPath,
      ],
      { cwd: worktreePath },
    );

    return {
      number: existingPullRequests[0].number,
      url: existingPullRequests[0].url,
      created: false,
    };
  }

  const created = await runCommandImpl(
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
      pullRequestTitle,
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

async function deployPreviewIfConfigured(contributionId, repoPath, runtimeConfig) {
  const previewDeployScript = resolvePreviewDeployScriptPath(runtimeConfig, repoPath);

  if (!previewDeployScript || !existsSync(previewDeployScript)) {
    return null;
  }

  await runCommand('bash', [previewDeployScript, contributionId, repoPath], {
    cwd: repoPath,
  });

  const previewUrl = buildResolvedPreviewUrl(runtimeConfig, contributionId);

  if (!previewUrl) {
    return null;
  }

  const response = await fetch(previewUrl, {
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Preview deploy did not respond cleanly: ${response.status}`);
  }

  return previewUrl;
}

export async function processClaimedJob(pool, database, claimedJob) {
  var detail = null;
  var repo = null;
  var branchName = claimedJob.branch_name || null;
  var worktreePath = null;
  var checkout = null;
  const verification = [];

  try {
    detail = await database.getContributionDetail(claimedJob.contribution_id);

    if (!detail || !detail.contribution) {
      await updateImplementationJob(pool, claimedJob.id, {
        status: 'failed',
        finished_at: nowIso(),
        error_summary: 'Contribution detail could not be loaded.',
      });
      return;
    }

    if (!branchName) {
      branchName = buildBranchName(detail.contribution.id, detail.contribution.title);
    }
    worktreePath = join(tmpdir(), `crowdship-${detail.contribution.id}`);

    repo = resolveRepositoryWorkspaceConfig(detail, claimedJob);
    if (!repo.repositoryFullName) {
      throw new Error(`Project runtime config is missing repositoryFullName for ${detail.contribution.projectSlug}`);
    }
    if (!repo.defaultBranch) {
      throw new Error(`Project runtime config is missing defaultBranch for ${detail.contribution.projectSlug}`);
    }
    if (repo.checkoutMode === 'local_path' && !existsSync(repo.repoPath)) {
      throw new Error(`Target repository path does not exist: ${repo.repoPath}`);
    }
    if (repo.checkoutMode === 'unconfigured') {
      throw new Error(`Project runtime config is missing repoPath or repository clone settings for ${detail.contribution.projectSlug}`);
    }

    const implementationService = createConfiguredImplementationService();

    await emitProgress(database, detail.contribution.id, {
      nextState: 'agent_running',
      kind: 'agent_step',
      message: 'Inspecting target repository.',
      payload: {
        contributionId: detail.contribution.id,
        branchName,
        repositoryFullName: repo.repositoryFullName,
        checkoutMode: repo.checkoutMode,
      },
    });
    checkout = await ensureRepositoryCheckout(repo, branchName, worktreePath);
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
      message: 'Implementing the approved change in the repository.',
      payload: {
        contributionId: detail.contribution.id,
        branchName,
      },
    });
    const implementationProfile = resolveImplementationProfile(detail, repo);
    const implementationEditOptions = {
      allowedPrefixes: implementationProfile.allowedPrefixes,
    };

    const implementationResult = await implementationService.generateChanges({
      detail,
      worktreePath,
      runtimeConfig: repo,
    });
    const changedFiles = writeImplementationEdits(worktreePath, implementationResult.files, implementationEditOptions);
    await emitProgress(database, detail.contribution.id, {
      nextState: 'agent_running',
      kind: 'agent_step',
      message: implementationResult.summary,
      payload: {
        contributionId: detail.contribution.id,
        branchName,
        changedFiles,
      },
    });

    let repairAttempted = false;

    for (;;) {
      await emitProgress(database, detail.contribution.id, {
        nextState: 'agent_running',
        kind: 'verification_started',
        message: 'Running repository verification.',
        payload: {
          contributionId: detail.contribution.id,
        },
      });

      try {
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
        break;
      } catch (error) {
        if (repairAttempted || error?.name !== 'VerificationError') {
          throw error;
        }

        repairAttempted = true;
        await emitProgress(database, detail.contribution.id, {
          nextState: 'agent_running',
          kind: 'agent_step',
          message: 'Verification failed. Repairing the implementation.',
          payload: {
            contributionId: detail.contribution.id,
            command: error.command ?? null,
          },
        });

        const repairResult = await implementationService.repairChanges({
          detail,
          worktreePath,
          verificationFailure: {
            command: error.command ?? null,
            stdout: error.stdout ?? '',
            stderr: error.stderr ?? '',
          },
          runtimeConfig: repo,
        });
        const repairedFiles = writeImplementationEdits(worktreePath, repairResult.files, implementationEditOptions);
        await emitProgress(database, detail.contribution.id, {
          nextState: 'agent_running',
          kind: 'agent_step',
          message: repairResult.summary,
          payload: {
            contributionId: detail.contribution.id,
            branchName,
            changedFiles: repairedFiles,
          },
        });
      }
    }

    await commitWorktreeChanges(worktreePath, detail);

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

    const previewUrl = await deployPreviewIfConfigured(detail.contribution.id, worktreePath, repo);
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
        ...(isPlainObject(claimedJob.metadata) ? claimedJob.metadata : {}),
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

    if (detail && detail.contribution && detail.contribution.id) {
      await emitProgress(database, detail.contribution.id, {
        nextState: IMPLEMENTATION_FAILED_CONTRIBUTION_STATE,
        kind: 'agent_step',
        message: error instanceof Error ? `Worker failed: ${error.message}` : 'Worker failed.',
        payload: {
          contributionId: detail.contribution.id,
        },
      });
    }
  } finally {
    await cleanupRepositoryCheckout(checkout, worktreePath);
  }
}

export const __testInternals = {
  buildGithubExtraHeader,
  cleanupRepositoryCheckout,
  ensureRepositoryCheckout,
  ensurePullRequest,
  withGithubExtraHeader,
};

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
