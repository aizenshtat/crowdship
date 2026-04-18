import { Pool } from 'pg';

import { getProjectSeedRecord } from '../shared/contracts.js';

function cloneValue(value) {
  return value == null ? value : structuredClone(value);
}

function cloneRecord(record) {
  return cloneValue(record);
}

function sortByCreatedAt(list) {
  return list.slice().sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
}

function sortSpecVersions(list) {
  return list.slice().sort((left, right) => left.versionNumber - right.versionNumber);
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
}) {
  return {
    contribution: cloneRecord(contribution),
    attachments: sortByCreatedAt(attachments).map(cloneRecord),
    messages: sortByCreatedAt(messages).map(cloneRecord),
    specVersions: sortSpecVersions(specVersions).map(cloneRecord),
    progressEvents: sortByCreatedAt(progressEvents).map(cloneRecord),
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

async function seedProject(client, projectSlug, updatedAt) {
  const project = getProjectSeedRecord(projectSlug);

  if (!project) {
    throw new Error(`Unknown project slug: ${projectSlug}`);
  }

  await client.query(
    `
      INSERT INTO projects (
        slug,
        name,
        public_config,
        allowed_origins,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::timestamptz, $5::timestamptz)
      ON CONFLICT (slug) DO UPDATE
      SET
        name = EXCLUDED.name,
        public_config = EXCLUDED.public_config,
        allowed_origins = EXCLUDED.allowed_origins,
        updated_at = EXCLUDED.updated_at
    `,
    [
      project.slug,
      project.name,
      JSON.stringify(project.publicConfig),
      JSON.stringify(project.allowedOrigins),
      updatedAt,
    ],
  );
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

  const [attachmentResult, messageResult, specResult, progressResult] = await Promise.all([
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
  ]);

  return buildContributionDetail({
    contribution: mapContributionRow(contributionResult.rows[0]),
    attachments: attachmentResult.rows.map(mapAttachmentRow),
    messages: messageResult.rows.map(mapMessageRow),
    specVersions: specResult.rows.map(mapSpecVersionRow),
    progressEvents: progressResult.rows.map(mapProgressEventRow),
  });
}

export function createInMemoryContributionPersistenceAdapter({
  clock = () => new Date(),
} = {}) {
  const contributions = new Map();
  const attachments = new Map();
  const messages = new Map();
  const specVersions = new Map();
  const progressEvents = new Map();

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
    });
  }

  return {
    connected: true,
    kind: 'in-memory-contribution-persistence',
    async listContributions() {
      return Array.from(contributions.keys())
        .map((contributionId) => getContributionDetail(contributionId))
        .filter(Boolean);
    },
    async createContribution({ contribution, attachments: nextAttachments, messages: nextMessages, specVersions: nextSpecVersions, progressEvents: nextProgressEvents }) {
      const contributionId = contribution.id;
      contributions.set(contributionId, cloneRecord(contribution));
      setStoredList(attachments, contributionId, nextAttachments);
      setStoredList(messages, contributionId, nextMessages);
      setStoredList(specVersions, contributionId, nextSpecVersions);
      setStoredList(progressEvents, contributionId, nextProgressEvents);
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
    async applyContributionUpdate({
      contributionId,
      nextState,
      updatedAt,
      messages: nextMessages = [],
      specVersions: nextSpecVersions = [],
      progressEvents: nextProgressEvents = [],
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
        await seedProject(client, contribution.projectSlug, contribution.updatedAt);
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
    async applyContributionUpdate({
      contributionId,
      nextState,
      updatedAt,
      messages = [],
      specVersions = [],
      progressEvents = [],
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
