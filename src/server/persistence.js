import { Pool } from 'pg';

import { listProjectSeedRecords } from '../shared/contracts.js';

function cloneValue(value) {
  return value == null ? value : structuredClone(value);
}

function cloneRecord(record) {
  return cloneValue(record);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStringList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

function normalizeProjectRecord(project, { existing = null, clock } = {}) {
  const slug = typeof project?.slug === 'string' ? project.slug.trim() : '';

  if (!slug) {
    throw new Error('Project slug is required.');
  }

  const publicConfigInput = isPlainObject(project?.publicConfig) ? project.publicConfig : {};
  const allowedOrigins = normalizeStringList(project?.allowedOrigins ?? publicConfigInput.allowedOrigins);
  const contributionStates = normalizeStringList(publicConfigInput.contributionStates);
  const runtimeConfig = isPlainObject(project?.runtimeConfig) ? structuredClone(project.runtimeConfig) : {};
  const now = toIsoTimestamp(clock ?? new Date());

  return {
    slug,
    name: typeof project?.name === 'string' && project.name.trim() ? project.name.trim() : slug,
    publicConfig: {
      project: slug,
      widgetScriptUrl:
        typeof publicConfigInput.widgetScriptUrl === 'string' && publicConfigInput.widgetScriptUrl.trim()
          ? publicConfigInput.widgetScriptUrl.trim()
          : null,
      allowedOrigins,
      contributionStates,
    },
    allowedOrigins,
    runtimeConfig,
    createdAt: project?.createdAt ?? existing?.createdAt ?? now,
    updatedAt: project?.updatedAt ?? now,
  };
}

function buildProjectPublicConfig(project) {
  if (!project) {
    return null;
  }

  const publicConfig = isPlainObject(project.publicConfig) ? project.publicConfig : {};

  return {
    project: project.slug,
    widgetScriptUrl: publicConfig.widgetScriptUrl ?? null,
    allowedOrigins: [...normalizeStringList(project.allowedOrigins ?? publicConfig.allowedOrigins)],
    contributionStates: [...normalizeStringList(publicConfig.contributionStates)],
  };
}

function sortByCreatedAt(list) {
  return list.slice().sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
}

function sortSpecVersions(list) {
  return list.slice().sort((left, right) => left.versionNumber - right.versionNumber);
}

function sortByUpdatedAt(list) {
  return list.slice().sort((left, right) => String(left.updatedAt ?? left.createdAt).localeCompare(String(right.updatedAt ?? right.createdAt)));
}

function toIsoTimestamp(clock) {
  const value = typeof clock === 'function' ? clock() : clock;
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

function buildContributionDetail({
  contribution,
  attachments = [],
  messages = [],
  specVersions = [],
  progressEvents = [],
  implementationJobs = [],
  pullRequests = [],
  previewDeployments = [],
  votes = [],
  comments = [],
}) {
  return {
    contribution: cloneRecord(contribution),
    attachments: sortByCreatedAt(attachments).map(cloneRecord),
    messages: sortByCreatedAt(messages).map(cloneRecord),
    specVersions: sortSpecVersions(specVersions).map(cloneRecord),
    progressEvents: sortByCreatedAt(progressEvents).map(cloneRecord),
    implementationJobs: sortByCreatedAt(implementationJobs).map(cloneRecord),
    pullRequests: sortByUpdatedAt(pullRequests).map(cloneRecord),
    previewDeployments: sortByCreatedAt(previewDeployments).map(cloneRecord),
    votes: sortByCreatedAt(votes).map(cloneRecord),
    comments: sortByCreatedAt(comments).map(cloneRecord),
  };
}

function mapContributionRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    projectSlug: row.projectSlug,
    environment: row.payload?.environment ?? 'production',
    state: row.state,
    type: row.type,
    title: row.title,
    body: row.body ?? null,
    payload: row.payload ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapProjectRow(row) {
  if (!row) {
    return null;
  }

  return normalizeProjectRecord(
    {
      slug: row.slug,
      name: row.name,
      publicConfig: row.publicConfig ?? {},
      allowedOrigins: row.allowedOrigins ?? [],
      runtimeConfig: row.runtimeConfig ?? {},
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    {
      existing: row,
      clock: row.updatedAt ?? row.createdAt ?? new Date(),
    },
  );
}

function mapAttachmentRow(row) {
  return {
    id: row.id,
    contributionId: row.contributionId,
    kind: row.kind,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: Number(row.sizeBytes),
    storageKey: row.storageKey,
    createdAt: row.createdAt,
  };
}

function mapMessageRow(row) {
  return {
    id: row.id,
    contributionId: row.contributionId,
    authorRole: row.authorRole,
    messageType: row.messageType,
    body: row.body,
    choices: row.choices ?? null,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt,
  };
}

function mapSpecVersionRow(row) {
  return {
    id: row.id,
    contributionId: row.contributionId,
    versionNumber: Number(row.versionNumber),
    title: row.title,
    goal: row.goal,
    userProblem: row.userProblem,
    spec: row.spec ?? {},
    approvedAt: row.approvedAt ?? null,
    createdAt: row.createdAt,
  };
}

function mapProgressEventRow(row) {
  return {
    id: row.id,
    contributionId: row.contributionId,
    kind: row.kind,
    status: row.status,
    message: row.message,
    externalUrl: row.externalUrl ?? null,
    payload: row.payload ?? null,
    createdAt: row.createdAt,
  };
}

function mapImplementationJobRow(row) {
  return {
    id: row.id,
    contributionId: row.contributionId,
    status: row.status,
    queueName: row.queueName,
    branchName: row.branchName ?? null,
    repositoryFullName: row.repositoryFullName ?? null,
    githubRunId: row.githubRunId ?? null,
    startedAt: row.startedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    errorSummary: row.errorSummary ?? null,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt,
  };
}

function mapPullRequestRow(row) {
  return {
    id: row.id,
    contributionId: row.contributionId,
    repositoryFullName: row.repositoryFullName,
    number: Number(row.number),
    url: row.url,
    branchName: row.branchName,
    headSha: row.headSha ?? null,
    status: row.status,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapPreviewDeploymentRow(row) {
  return {
    id: row.id,
    contributionId: row.contributionId,
    pullRequestId: row.pullRequestId ?? null,
    url: row.url,
    status: row.status,
    gitSha: row.gitSha ?? null,
    deployKind: row.deployKind,
    deployedAt: row.deployedAt ?? null,
    checkedAt: row.checkedAt ?? null,
    errorSummary: row.errorSummary ?? null,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt,
  };
}

function mapVoteRow(row) {
  return {
    id: row.id,
    contributionId: row.contributionId,
    voterUserId: row.voterUserId ?? null,
    voterEmail: row.voterEmail ?? null,
    voteType: row.voteType,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt,
  };
}

function mapCommentRow(row) {
  return {
    id: row.id,
    contributionId: row.contributionId,
    authorUserId: row.authorUserId ?? null,
    authorRole: row.authorRole,
    body: row.body,
    disposition: row.disposition,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt,
  };
}

async function withTransaction(pool, callback) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function readProjectFromPostgres(queryable, projectSlug) {
  const result = await queryable.query(
    `
      SELECT
        slug,
        name,
        public_config AS "publicConfig",
        allowed_origins AS "allowedOrigins",
        runtime_config AS "runtimeConfig",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projects
      WHERE slug = $1
    `,
    [projectSlug],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapProjectRow(result.rows[0]);
}

async function listProjectsFromPostgres(queryable) {
  const result = await queryable.query(
    `
      SELECT
        slug,
        name,
        public_config AS "publicConfig",
        allowed_origins AS "allowedOrigins",
        runtime_config AS "runtimeConfig",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projects
      ORDER BY slug ASC
    `,
  );

  return result.rows.map(mapProjectRow);
}

async function upsertProjectInPostgres(queryable, project, clock = () => new Date()) {
  const normalized = normalizeProjectRecord(project, {
    clock,
  });
  const result = await queryable.query(
    `
      INSERT INTO projects (
        slug,
        name,
        public_config,
        allowed_origins,
        runtime_config,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::timestamptz, $7::timestamptz)
      ON CONFLICT (slug) DO UPDATE
      SET
        name = EXCLUDED.name,
        public_config = EXCLUDED.public_config,
        allowed_origins = EXCLUDED.allowed_origins,
        runtime_config = EXCLUDED.runtime_config,
        updated_at = EXCLUDED.updated_at
      RETURNING
        slug,
        name,
        public_config AS "publicConfig",
        allowed_origins AS "allowedOrigins",
        runtime_config AS "runtimeConfig",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [
      normalized.slug,
      normalized.name,
      JSON.stringify(normalized.publicConfig),
      JSON.stringify(normalized.allowedOrigins),
      JSON.stringify(normalized.runtimeConfig),
      normalized.createdAt,
      normalized.updatedAt,
    ],
  );

  return mapProjectRow(result.rows[0]);
}

async function readContributionDetailFromPostgres(queryable, contributionId) {
  const contributionResult = await queryable.query(
    `
      SELECT
        id,
        project_slug AS "projectSlug",
        state,
        type,
        title,
        body,
        payload,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM contributions
      WHERE id = $1
    `,
    [contributionId],
  );

  if (contributionResult.rowCount === 0) {
    return null;
  }

  const [
    attachmentResult,
    messageResult,
    specResult,
    progressResult,
    implementationJobResult,
    pullRequestResult,
    previewDeploymentResult,
    voteResult,
    commentResult,
  ] = await Promise.all([
    queryable.query(
      `
        SELECT
          id,
          contribution_id AS "contributionId",
          kind,
          filename,
          content_type AS "contentType",
          size_bytes AS "sizeBytes",
          storage_key AS "storageKey",
          created_at AS "createdAt"
        FROM attachments
        WHERE contribution_id = $1
        ORDER BY created_at ASC
      `,
      [contributionId],
    ),
    queryable.query(
      `
        SELECT
          id,
          contribution_id AS "contributionId",
          author_role AS "authorRole",
          message_type AS "messageType",
          body,
          choices,
          metadata,
          created_at AS "createdAt"
        FROM chat_messages
        WHERE contribution_id = $1
        ORDER BY created_at ASC
      `,
      [contributionId],
    ),
    queryable.query(
      `
        SELECT
          id,
          contribution_id AS "contributionId",
          version_number AS "versionNumber",
          title,
          goal,
          user_problem AS "userProblem",
          spec,
          approved_at AS "approvedAt",
          created_at AS "createdAt"
        FROM spec_versions
        WHERE contribution_id = $1
        ORDER BY version_number ASC
      `,
      [contributionId],
    ),
    queryable.query(
      `
        SELECT
          id,
          contribution_id AS "contributionId",
          kind,
          status,
          message,
          external_url AS "externalUrl",
          payload,
          created_at AS "createdAt"
        FROM progress_events
        WHERE contribution_id = $1
        ORDER BY created_at ASC
      `,
      [contributionId],
    ),
    queryable.query(
      `
        SELECT
          id,
          contribution_id AS "contributionId",
          status,
          queue_name AS "queueName",
          branch_name AS "branchName",
          repository_full_name AS "repositoryFullName",
          github_run_id AS "githubRunId",
          started_at AS "startedAt",
          finished_at AS "finishedAt",
          error_summary AS "errorSummary",
          metadata,
          created_at AS "createdAt"
        FROM implementation_jobs
        WHERE contribution_id = $1
        ORDER BY created_at ASC
      `,
      [contributionId],
    ),
    queryable.query(
      `
        SELECT
          id,
          contribution_id AS "contributionId",
          repository_full_name AS "repositoryFullName",
          number,
          url,
          branch_name AS "branchName",
          head_sha AS "headSha",
          status,
          metadata,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM pull_requests
        WHERE contribution_id = $1
        ORDER BY updated_at ASC
      `,
      [contributionId],
    ),
    queryable.query(
      `
        SELECT
          id,
          contribution_id AS "contributionId",
          pull_request_id AS "pullRequestId",
          url,
          status,
          git_sha AS "gitSha",
          deploy_kind AS "deployKind",
          deployed_at AS "deployedAt",
          checked_at AS "checkedAt",
          error_summary AS "errorSummary",
          metadata,
          created_at AS "createdAt"
        FROM preview_deployments
        WHERE contribution_id = $1
        ORDER BY created_at ASC
      `,
      [contributionId],
    ),
    queryable.query(
      `
        SELECT
          id,
          contribution_id AS "contributionId",
          voter_user_id AS "voterUserId",
          voter_email AS "voterEmail",
          vote_type AS "voteType",
          metadata,
          created_at AS "createdAt"
        FROM votes
        WHERE contribution_id = $1
        ORDER BY created_at ASC
      `,
      [contributionId],
    ),
    queryable.query(
      `
        SELECT
          id,
          contribution_id AS "contributionId",
          author_user_id AS "authorUserId",
          author_role AS "authorRole",
          body,
          disposition,
          metadata,
          created_at AS "createdAt"
        FROM comments
        WHERE contribution_id = $1
        ORDER BY created_at ASC
      `,
      [contributionId],
    ),
  ]);

  return buildContributionDetail({
    contribution: mapContributionRow(contributionResult.rows[0]),
    attachments: attachmentResult.rows.map(mapAttachmentRow),
    messages: messageResult.rows.map(mapMessageRow),
    specVersions: specResult.rows.map(mapSpecVersionRow),
    progressEvents: progressResult.rows.map(mapProgressEventRow),
    implementationJobs: implementationJobResult.rows.map(mapImplementationJobRow),
    pullRequests: pullRequestResult.rows.map(mapPullRequestRow),
    previewDeployments: previewDeploymentResult.rows.map(mapPreviewDeploymentRow),
    votes: voteResult.rows.map(mapVoteRow),
    comments: commentResult.rows.map(mapCommentRow),
  });
}

export function createInMemoryContributionPersistenceAdapter({
  clock = () => new Date(),
  initialProjects = listProjectSeedRecords(),
} = {}) {
  const projects = new Map();
  const contributions = new Map();
  const attachments = new Map();
  const messages = new Map();
  const specVersions = new Map();
  const progressEvents = new Map();
  const implementationJobs = new Map();
  const pullRequests = new Map();
  const previewDeployments = new Map();
  const votes = new Map();
  const comments = new Map();

  for (const project of initialProjects) {
    const normalized = normalizeProjectRecord(project, {
      clock,
    });
    projects.set(normalized.slug, normalized);
  }

  function getStoredContribution(contributionId) {
    const contribution = contributions.get(contributionId);
    return contribution ? cloneRecord(contribution) : null;
  }

  function getStoredList(store, contributionId, sorter = sortByCreatedAt) {
    const values = store.get(contributionId) ?? [];
    return sorter(values).map(cloneRecord);
  }

  function setStoredList(store, contributionId, values) {
    store.set(contributionId, values.map(cloneRecord));
  }

  function getContributionDetail(contributionId) {
    const contribution = getStoredContribution(contributionId);

    if (!contribution) {
      return null;
    }

    return buildContributionDetail({
      contribution,
      attachments: getStoredList(attachments, contributionId),
      messages: getStoredList(messages, contributionId),
      specVersions: getStoredList(specVersions, contributionId, sortSpecVersions),
      progressEvents: getStoredList(progressEvents, contributionId),
      implementationJobs: getStoredList(implementationJobs, contributionId),
      pullRequests: getStoredList(pullRequests, contributionId, sortByUpdatedAt),
      previewDeployments: getStoredList(previewDeployments, contributionId),
      votes: getStoredList(votes, contributionId),
      comments: getStoredList(comments, contributionId),
    });
  }

  return {
    connected: true,
    kind: 'in-memory-contribution-persistence',
    async listProjects() {
      return Array.from(projects.values())
        .slice()
        .sort((left, right) => left.slug.localeCompare(right.slug))
        .map(cloneRecord);
    },
    async getProject(projectSlug) {
      const project = projects.get(projectSlug);
      return project ? cloneRecord(project) : null;
    },
    async getProjectPublicConfig(projectSlug) {
      const project = projects.get(projectSlug);
      return buildProjectPublicConfig(project);
    },
    async upsertProject(project) {
      const existing = projects.get(project.slug);
      const normalized = normalizeProjectRecord(project, {
        existing,
        clock,
      });
      projects.set(normalized.slug, normalized);
      return cloneRecord(normalized);
    },
    async listContributions() {
      return Array.from(contributions.keys())
        .map((contributionId) => getContributionDetail(contributionId))
        .filter(Boolean);
    },
    async createContribution({ contribution, attachments: nextAttachments, messages: nextMessages, specVersions: nextSpecVersions, progressEvents: nextProgressEvents }) {
      const contributionId = contribution.id;

      if (!projects.has(contribution.projectSlug)) {
        throw new Error(`Unknown project slug: ${contribution.projectSlug}`);
      }

      contributions.set(contributionId, cloneRecord(contribution));
      setStoredList(attachments, contributionId, nextAttachments);
      setStoredList(messages, contributionId, nextMessages);
      setStoredList(specVersions, contributionId, nextSpecVersions);
      setStoredList(progressEvents, contributionId, nextProgressEvents);
      setStoredList(implementationJobs, contributionId, []);
      setStoredList(pullRequests, contributionId, []);
      setStoredList(previewDeployments, contributionId, []);
      setStoredList(votes, contributionId, []);
      setStoredList(comments, contributionId, []);
      return getContributionDetail(contributionId);
    },
    async getContribution(contributionId) {
      return getStoredContribution(contributionId);
    },
    async getContributionDetail(contributionId) {
      return getContributionDetail(contributionId);
    },
    async getContributionProgress(contributionId) {
      const detail = getContributionDetail(contributionId);

      if (!detail) {
        return null;
      }

      return {
        contribution: detail.contribution,
        progressEvents: detail.progressEvents,
      };
    },
    async replaceAttachmentStorageKey({ contributionId, attachmentId, storageKey }) {
      if (!contributions.has(contributionId)) {
        return null;
      }

      const existingAttachments = attachments.get(contributionId) ?? [];
      let updatedAttachment = null;
      const nextAttachments = existingAttachments.map((attachment) => {
        if (attachment.id !== attachmentId || typeof attachment.storageKey !== 'string') {
          return attachment;
        }

        if (!attachment.storageKey.startsWith('metadata-only://')) {
          return attachment;
        }

        updatedAttachment = {
          ...attachment,
          storageKey,
        };
        return updatedAttachment;
      });

      if (!updatedAttachment) {
        return null;
      }

      setStoredList(attachments, contributionId, nextAttachments);
      return cloneRecord(updatedAttachment);
    },
    async applyContributionUpdate({
      contributionId,
      nextState,
      updatedAt,
      messages: nextMessages = [],
      specVersions: nextSpecVersions = [],
      progressEvents: nextProgressEvents = [],
      implementationJobs: nextImplementationJobs = [],
      pullRequests: nextPullRequests = [],
      updatedPullRequests = [],
      previewDeployments: nextPreviewDeployments = [],
      votes: nextVotes = [],
      comments: nextComments = [],
      updatedComments = [],
      approvedSpecVersionId,
      approvedAt,
    }) {
      if (!contributions.has(contributionId)) {
        return null;
      }

      const contribution = contributions.get(contributionId);
      contributions.set(contributionId, {
        ...contribution,
        state: nextState,
        updatedAt: updatedAt ?? toIsoTimestamp(clock),
      });

      if (nextMessages.length > 0) {
        const existingMessages = messages.get(contributionId) ?? [];
        setStoredList(messages, contributionId, existingMessages.concat(nextMessages));
      }

      if (nextSpecVersions.length > 0) {
        const existingSpecVersions = specVersions.get(contributionId) ?? [];
        setStoredList(specVersions, contributionId, existingSpecVersions.concat(nextSpecVersions));
      }

      if (nextProgressEvents.length > 0) {
        const existingProgressEvents = progressEvents.get(contributionId) ?? [];
        setStoredList(progressEvents, contributionId, existingProgressEvents.concat(nextProgressEvents));
      }

      if (nextImplementationJobs.length > 0) {
        const existingImplementationJobs = implementationJobs.get(contributionId) ?? [];
        setStoredList(implementationJobs, contributionId, existingImplementationJobs.concat(nextImplementationJobs));
      }

      if (nextPullRequests.length > 0) {
        const existingPullRequests = pullRequests.get(contributionId) ?? [];
        setStoredList(pullRequests, contributionId, existingPullRequests.concat(nextPullRequests));
      }

      if (updatedPullRequests.length > 0) {
        const existingPullRequests = pullRequests.get(contributionId) ?? [];
        const byId = new Map(updatedPullRequests.map((pullRequest) => [pullRequest.id, pullRequest]));
        setStoredList(
          pullRequests,
          contributionId,
          existingPullRequests.map((pullRequest) => byId.get(pullRequest.id) ?? pullRequest),
        );
      }

      if (nextPreviewDeployments.length > 0) {
        const existingPreviewDeployments = previewDeployments.get(contributionId) ?? [];
        setStoredList(previewDeployments, contributionId, existingPreviewDeployments.concat(nextPreviewDeployments));
      }

      if (nextVotes.length > 0) {
        const existingVotes = votes.get(contributionId) ?? [];
        setStoredList(votes, contributionId, existingVotes.concat(nextVotes));
      }

      if (nextComments.length > 0) {
        const existingComments = comments.get(contributionId) ?? [];
        setStoredList(comments, contributionId, existingComments.concat(nextComments));
      }

      if (updatedComments.length > 0) {
        const existingComments = comments.get(contributionId) ?? [];
        const byId = new Map(updatedComments.map((comment) => [comment.id, comment]));
        setStoredList(
          comments,
          contributionId,
          existingComments.map((comment) => byId.get(comment.id) ?? comment),
        );
      }

      if (approvedSpecVersionId) {
        const existingSpecVersions = (specVersions.get(contributionId) ?? []).map((specVersion) =>
          specVersion.id === approvedSpecVersionId
            ? {
                ...specVersion,
                approvedAt: approvedAt ?? toIsoTimestamp(clock),
              }
            : specVersion,
        );
        setStoredList(specVersions, contributionId, existingSpecVersions);
      }

      return getContributionDetail(contributionId);
    },
  };
}

export function createPostgresContributionPersistenceAdapter({
  connectionString = process.env.DATABASE_URL,
  pool = connectionString ? new Pool({ connectionString }) : null,
} = {}) {
  if (!pool) {
    throw new Error('A Postgres pool or DATABASE_URL is required.');
  }

  return {
    connected: true,
    kind: 'postgres-contribution-persistence',
    async listProjects() {
      return listProjectsFromPostgres(pool);
    },
    async getProject(projectSlug) {
      return readProjectFromPostgres(pool, projectSlug);
    },
    async getProjectPublicConfig(projectSlug) {
      const project = await readProjectFromPostgres(pool, projectSlug);
      return buildProjectPublicConfig(project);
    },
    async upsertProject(project) {
      return upsertProjectInPostgres(pool, project);
    },
    async listContributions() {
      const result = await pool.query(
        `
          SELECT id
          FROM contributions
          ORDER BY created_at DESC
        `,
      );

      const details = await Promise.all(
        result.rows.map((row) => readContributionDetailFromPostgres(pool, row.id)),
      );

      return details.filter(Boolean);
    },
    async createContribution({ contribution, attachments, messages, specVersions, progressEvents }) {
      return withTransaction(pool, async (client) => {
        await client.query(
          `
            INSERT INTO contributions (
              id,
              project_slug,
              state,
              type,
              title,
              body,
              payload,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, $9::timestamptz)
          `,
          [
            contribution.id,
            contribution.projectSlug,
            contribution.state,
            contribution.type,
            contribution.title,
            contribution.body,
            JSON.stringify(contribution.payload),
            contribution.createdAt,
            contribution.updatedAt,
          ],
        );

        for (const attachment of attachments) {
          await client.query(
            `
              INSERT INTO attachments (
                id,
                contribution_id,
                kind,
                filename,
                content_type,
                size_bytes,
                storage_key,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)
            `,
            [
              attachment.id,
              attachment.contributionId,
              attachment.kind,
              attachment.filename,
              attachment.contentType,
              attachment.sizeBytes,
              attachment.storageKey,
              attachment.createdAt,
            ],
          );
        }

        for (const message of messages) {
          await client.query(
            `
              INSERT INTO chat_messages (
                id,
                contribution_id,
                author_role,
                message_type,
                body,
                choices,
                metadata,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::timestamptz)
            `,
            [
              message.id,
              message.contributionId,
              message.authorRole,
              message.messageType,
              message.body,
              message.choices == null ? null : JSON.stringify(message.choices),
              message.metadata == null ? null : JSON.stringify(message.metadata),
              message.createdAt,
            ],
          );
        }

        for (const specVersion of specVersions) {
          await client.query(
            `
              INSERT INTO spec_versions (
                id,
                contribution_id,
                version_number,
                title,
                goal,
                user_problem,
                spec,
                approved_at,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, $9::timestamptz)
            `,
            [
              specVersion.id,
              specVersion.contributionId,
              specVersion.versionNumber,
              specVersion.title,
              specVersion.goal,
              specVersion.userProblem,
              JSON.stringify(specVersion.spec),
              specVersion.approvedAt,
              specVersion.createdAt,
            ],
          );
        }

        for (const progressEvent of progressEvents) {
          await client.query(
            `
              INSERT INTO progress_events (
                id,
                contribution_id,
                kind,
                status,
                message,
                external_url,
                payload,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)
            `,
            [
              progressEvent.id,
              progressEvent.contributionId,
              progressEvent.kind,
              progressEvent.status,
              progressEvent.message,
              progressEvent.externalUrl,
              progressEvent.payload == null ? null : JSON.stringify(progressEvent.payload),
              progressEvent.createdAt,
            ],
          );
        }

        return readContributionDetailFromPostgres(client, contribution.id);
      });
    },
    async getContribution(contributionId) {
      const detail = await readContributionDetailFromPostgres(pool, contributionId);
      return detail?.contribution ?? null;
    },
    async getContributionDetail(contributionId) {
      return readContributionDetailFromPostgres(pool, contributionId);
    },
    async getContributionProgress(contributionId) {
      const detail = await readContributionDetailFromPostgres(pool, contributionId);

      if (!detail) {
        return null;
      }

      return {
        contribution: detail.contribution,
        progressEvents: detail.progressEvents,
      };
    },
    async replaceAttachmentStorageKey({ contributionId, attachmentId, storageKey }) {
      const result = await pool.query(
        `
          UPDATE attachments
          SET storage_key = $3
          WHERE contribution_id = $1
            AND id = $2
            AND storage_key LIKE 'metadata-only://%'
          RETURNING
            id,
            contribution_id AS "contributionId",
            kind,
            filename,
            content_type AS "contentType",
            size_bytes AS "sizeBytes",
            storage_key AS "storageKey",
            created_at AS "createdAt"
        `,
        [contributionId, attachmentId, storageKey],
      );

      if (result.rowCount === 0) {
        return null;
      }

      return mapAttachmentRow(result.rows[0]);
    },
    async applyContributionUpdate({
      contributionId,
      nextState,
      updatedAt,
      messages = [],
      specVersions = [],
      progressEvents = [],
      implementationJobs = [],
      pullRequests = [],
      updatedPullRequests = [],
      previewDeployments = [],
      votes = [],
      comments = [],
      updatedComments = [],
      approvedSpecVersionId,
      approvedAt,
    }) {
      return withTransaction(pool, async (client) => {
        const current = await readContributionDetailFromPostgres(client, contributionId);

        if (!current) {
          return null;
        }

        await client.query(
          `
            UPDATE contributions
            SET
              state = $2,
              updated_at = $3::timestamptz
            WHERE id = $1
          `,
          [contributionId, nextState, updatedAt],
        );

        if (approvedSpecVersionId) {
          await client.query(
            `
              UPDATE spec_versions
              SET approved_at = $2::timestamptz
              WHERE id = $1
            `,
            [approvedSpecVersionId, approvedAt ?? updatedAt],
          );
        }

        for (const message of messages) {
          await client.query(
            `
              INSERT INTO chat_messages (
                id,
                contribution_id,
                author_role,
                message_type,
                body,
                choices,
                metadata,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::timestamptz)
            `,
            [
              message.id,
              message.contributionId,
              message.authorRole,
              message.messageType,
              message.body,
              message.choices == null ? null : JSON.stringify(message.choices),
              message.metadata == null ? null : JSON.stringify(message.metadata),
              message.createdAt,
            ],
          );
        }

        for (const specVersion of specVersions) {
          await client.query(
            `
              INSERT INTO spec_versions (
                id,
                contribution_id,
                version_number,
                title,
                goal,
                user_problem,
                spec,
                approved_at,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, $9::timestamptz)
            `,
            [
              specVersion.id,
              specVersion.contributionId,
              specVersion.versionNumber,
              specVersion.title,
              specVersion.goal,
              specVersion.userProblem,
              JSON.stringify(specVersion.spec),
              specVersion.approvedAt,
              specVersion.createdAt,
            ],
          );
        }

        for (const progressEvent of progressEvents) {
          await client.query(
            `
              INSERT INTO progress_events (
                id,
                contribution_id,
                kind,
                status,
                message,
                external_url,
                payload,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)
            `,
            [
              progressEvent.id,
              progressEvent.contributionId,
              progressEvent.kind,
              progressEvent.status,
              progressEvent.message,
              progressEvent.externalUrl,
              progressEvent.payload == null ? null : JSON.stringify(progressEvent.payload),
              progressEvent.createdAt,
            ],
          );
        }

        for (const implementationJob of implementationJobs) {
          await client.query(
            `
              INSERT INTO implementation_jobs (
                id,
                contribution_id,
                status,
                queue_name,
                branch_name,
                repository_full_name,
                github_run_id,
                started_at,
                finished_at,
                error_summary,
                metadata,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10, $11::jsonb, $12::timestamptz)
            `,
            [
              implementationJob.id,
              implementationJob.contributionId,
              implementationJob.status,
              implementationJob.queueName,
              implementationJob.branchName,
              implementationJob.repositoryFullName,
              implementationJob.githubRunId ?? null,
              implementationJob.startedAt ?? null,
              implementationJob.finishedAt ?? null,
              implementationJob.errorSummary ?? null,
              implementationJob.metadata == null ? null : JSON.stringify(implementationJob.metadata),
              implementationJob.createdAt,
            ],
          );
        }

        for (const pullRequest of pullRequests) {
          await client.query(
            `
              INSERT INTO pull_requests (
                id,
                contribution_id,
                repository_full_name,
                number,
                url,
                branch_name,
                head_sha,
                status,
                metadata,
                created_at,
                updated_at
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz, $11::timestamptz)
            `,
            [
              pullRequest.id,
              pullRequest.contributionId,
              pullRequest.repositoryFullName,
              pullRequest.number,
              pullRequest.url,
              pullRequest.branchName,
              pullRequest.headSha ?? null,
              pullRequest.status,
              pullRequest.metadata == null ? null : JSON.stringify(pullRequest.metadata),
              pullRequest.createdAt,
              pullRequest.updatedAt,
            ],
          );
        }

        for (const pullRequest of updatedPullRequests) {
          await client.query(
            `
              UPDATE pull_requests
              SET
                repository_full_name = $2,
                number = $3,
                url = $4,
                branch_name = $5,
                head_sha = $6,
                status = $7,
                metadata = $8::jsonb,
                updated_at = $9::timestamptz
              WHERE id = $1 AND contribution_id = $10
            `,
            [
              pullRequest.id,
              pullRequest.repositoryFullName,
              pullRequest.number,
              pullRequest.url,
              pullRequest.branchName,
              pullRequest.headSha ?? null,
              pullRequest.status,
              pullRequest.metadata == null ? null : JSON.stringify(pullRequest.metadata),
              pullRequest.updatedAt,
              contributionId,
            ],
          );
        }

        for (const previewDeployment of previewDeployments) {
          await client.query(
            `
              INSERT INTO preview_deployments (
                id,
                contribution_id,
                pull_request_id,
                url,
                status,
                git_sha,
                deploy_kind,
                deployed_at,
                checked_at,
                error_summary,
                metadata,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10, $11::jsonb, $12::timestamptz)
            `,
            [
              previewDeployment.id,
              previewDeployment.contributionId,
              previewDeployment.pullRequestId ?? null,
              previewDeployment.url,
              previewDeployment.status,
              previewDeployment.gitSha ?? null,
              previewDeployment.deployKind,
              previewDeployment.deployedAt ?? null,
              previewDeployment.checkedAt ?? null,
              previewDeployment.errorSummary ?? null,
              previewDeployment.metadata == null ? null : JSON.stringify(previewDeployment.metadata),
              previewDeployment.createdAt,
            ],
          );
        }

        for (const vote of votes) {
          await client.query(
            `
              INSERT INTO votes (
                id,
                contribution_id,
                voter_user_id,
                voter_email,
                vote_type,
                metadata,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)
            `,
            [
              vote.id,
              vote.contributionId,
              vote.voterUserId ?? null,
              vote.voterEmail ?? null,
              vote.voteType,
              vote.metadata == null ? null : JSON.stringify(vote.metadata),
              vote.createdAt,
            ],
          );
        }

        for (const comment of comments) {
          await client.query(
            `
              INSERT INTO comments (
                id,
                contribution_id,
                author_user_id,
                author_role,
                body,
                disposition,
                metadata,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)
            `,
            [
              comment.id,
              comment.contributionId,
              comment.authorUserId ?? null,
              comment.authorRole,
              comment.body,
              comment.disposition,
              comment.metadata == null ? null : JSON.stringify(comment.metadata),
              comment.createdAt,
            ],
          );
        }

        for (const comment of updatedComments) {
          await client.query(
            `
              UPDATE comments
              SET disposition = $2
              WHERE id = $1 AND contribution_id = $3
            `,
            [comment.id, comment.disposition, contributionId],
          );
        }

        return readContributionDetailFromPostgres(client, contributionId);
      });
    },
    async close() {
      await pool.end();
    },
  };
}

export function createConfiguredContributionPersistenceAdapter(options = {}) {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  const requireDatabase =
    options.requireDatabase ??
    (process.env.REQUIRE_DATABASE === '1' || process.env.NODE_ENV === 'production');

  if (connectionString) {
    return createPostgresContributionPersistenceAdapter({
      ...options,
      connectionString,
    });
  }

  if (requireDatabase) {
    throw new Error('DATABASE_URL is required when database persistence is enforced.');
  }

  return createInMemoryContributionPersistenceAdapter(options);
}
