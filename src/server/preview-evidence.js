import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const PREVIEW_EVIDENCE_MARKER = '<!-- crowdship-preview-status -->';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stripMarkdownCodeFence(value) {
  const normalized = normalizeOptionalString(value);
  const match = normalized.match(/^`(.+)`$/);
  return match ? match[1].trim() : normalized;
}

function normalizeStatusKey(value) {
  const normalized = normalizeOptionalString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || null;
}

function normalizeHttpUrl(value) {
  const normalized = normalizeOptionalString(value);
  return /^https?:\/\//i.test(normalized) ? normalized : null;
}

function parseCount(value) {
  const normalized = normalizeOptionalString(value);
  const match = normalized.match(/^(\d+)(?:\b|$)/);

  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function parseSentryRelease(value) {
  const normalized = stripMarkdownCodeFence(value);

  if (!normalized) {
    return null;
  }

  const lowered = normalized.toLowerCase();
  if (lowered.includes('not configured') || lowered.includes('failed')) {
    return null;
  }

  return normalized;
}

function parseMarkdownFields(body) {
  const fields = {};

  for (const line of String(body).split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*([^:]+):\s*(.+?)\s*$/);

    if (!match) {
      continue;
    }

    fields[match[1].trim().toLowerCase()] = match[2].trim();
  }

  return fields;
}

function byNewestUpdatedAt(left, right) {
  const leftValue = Date.parse(left.sourceUpdatedAt ?? left.sourceCreatedAt ?? '');
  const rightValue = Date.parse(right.sourceUpdatedAt ?? right.sourceCreatedAt ?? '');

  return rightValue - leftValue;
}

export class PreviewEvidenceServiceError extends Error {
  constructor(message, { code = 'preview_evidence_lookup_failed', statusCode = 502 } = {}) {
    super(message);
    this.name = 'PreviewEvidenceServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function isPreviewEvidenceServiceError(error) {
  return error instanceof PreviewEvidenceServiceError;
}

export function parsePreviewEvidenceComment(comment, expectedContributionId = null) {
  const source = typeof comment === 'string' ? { body: comment } : comment ?? {};
  const body = normalizeOptionalString(source.body);

  if (!body || !body.includes(PREVIEW_EVIDENCE_MARKER)) {
    return null;
  }

  const fields = parseMarkdownFields(body);
  const contributionId = stripMarkdownCodeFence(fields['contribution id']);

  if (expectedContributionId && contributionId && contributionId !== expectedContributionId) {
    return null;
  }

  const statusLabel = normalizeOptionalString(fields.status || fields['preview status']);
  const buildStatusLabel = normalizeOptionalString(fields.build);
  const previewUrlLabel = normalizeOptionalString(fields['preview url']);
  const sentryReleaseLabel = normalizeOptionalString(fields['sentry release']);
  const newUnhandledPreviewErrorsLabel = normalizeOptionalString(fields['new unhandled preview errors']);
  const failedPreviewSessionsLabel = normalizeOptionalString(fields['failed preview sessions']);

  return {
    status: normalizeStatusKey(statusLabel),
    statusLabel: statusLabel || null,
    contributionId: contributionId || null,
    branch: stripMarkdownCodeFence(fields.branch) || null,
    pullRequestUrl: normalizeHttpUrl(fields.pr),
    runUrl: normalizeHttpUrl(fields.run),
    buildStatus: normalizeStatusKey(buildStatusLabel),
    buildStatusLabel: buildStatusLabel || null,
    previewUrl: normalizeHttpUrl(previewUrlLabel),
    previewUrlLabel: previewUrlLabel || null,
    sentryRelease: parseSentryRelease(sentryReleaseLabel),
    sentryReleaseLabel: sentryReleaseLabel || null,
    sentryIssuesUrl: normalizeHttpUrl(fields['filtered sentry issues']),
    newUnhandledPreviewErrors: parseCount(newUnhandledPreviewErrorsLabel),
    newUnhandledPreviewErrorsLabel: newUnhandledPreviewErrorsLabel || null,
    failedPreviewSessions: parseCount(failedPreviewSessionsLabel),
    failedPreviewSessionsLabel: failedPreviewSessionsLabel || null,
    commentUrl: normalizeHttpUrl(source.html_url),
    sourceCreatedAt: normalizeOptionalString(source.created_at) || null,
    sourceUpdatedAt: normalizeOptionalString(source.updated_at) || null,
  };
}

export function createGithubPreviewEvidenceService({
  environment = process.env,
  ghBin = 'gh',
  maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return {
    async getPreviewEvidence({ repositoryFullName, pullRequestNumber, contributionId }) {
      const normalizedRepositoryFullName = normalizeOptionalString(repositoryFullName);
      const normalizedContributionId = normalizeOptionalString(contributionId) || null;
      const normalizedPullRequestNumber = Number.parseInt(String(pullRequestNumber ?? ''), 10);

      if (!normalizedRepositoryFullName || !Number.isFinite(normalizedPullRequestNumber)) {
        throw new PreviewEvidenceServiceError('Repository and pull request number are required for preview evidence lookup.', {
          code: 'invalid_preview_evidence_target',
          statusCode: 400,
        });
      }

      let stdout;
      try {
        ({ stdout } = await execFileAsync(
          ghBin,
          [
            'api',
            `repos/${normalizedRepositoryFullName}/issues/${normalizedPullRequestNumber}/comments?per_page=100`,
          ],
          {
            env: environment,
            maxBuffer: maxBufferBytes,
            timeout: timeoutMs,
          },
        ));
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
          throw new PreviewEvidenceServiceError('GitHub CLI is not installed on the Crowdship host.', {
            code: 'preview_evidence_unavailable',
            statusCode: 503,
          });
        }

        const message =
          normalizeOptionalString(error?.stderr) ||
          normalizeOptionalString(error?.stdout) ||
          (error instanceof Error ? error.message : 'GitHub preview evidence lookup failed.');

        throw new PreviewEvidenceServiceError(message, {
          code: 'preview_evidence_lookup_failed',
          statusCode: 502,
        });
      }

      let comments;
      try {
        comments = JSON.parse(stdout);
      } catch (error) {
        throw new PreviewEvidenceServiceError('GitHub preview evidence response was not valid JSON.', {
          code: 'preview_evidence_lookup_failed',
          statusCode: 502,
        });
      }

      const evidence = (Array.isArray(comments) ? comments : [])
        .map((comment) => parsePreviewEvidenceComment(comment, normalizedContributionId))
        .filter(Boolean)
        .sort(byNewestUpdatedAt)
        .at(0);

      if (!evidence) {
        throw new PreviewEvidenceServiceError('Preview evidence has not been published for this pull request yet.', {
          code: 'preview_evidence_not_found',
          statusCode: 404,
        });
      }

      return {
        repositoryFullName: normalizedRepositoryFullName,
        pullRequestNumber: normalizedPullRequestNumber,
        ...evidence,
      };
    },
  };
}

export function createConfiguredPreviewEvidenceService(options = {}) {
  return createGithubPreviewEvidenceService(options);
}
