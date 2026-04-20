import { randomUUID } from 'node:crypto';

import {
  getGitHubAppConfig,
  getGitHubAppInstallationForRepository,
  getGitHubAppMetadata,
  isGitHubApiError,
  verifyGitHubWebhookSignature,
} from '../github/app-auth.js';
import {
  AGENT_QUEUED_CONTRIBUTION_STATE,
  API_ROUTE_DEFINITIONS,
  COMPLETED_CONTRIBUTION_PROGRESS_EVENT_KIND,
  APPROVED_SPEC_PROGRESS_EVENT_KIND,
  APPROVED_PREVIEW_PROGRESS_EVENT_KIND,
  CLARIFICATION_REQUESTED_PROGRESS_EVENT_KIND,
  CREATED_CONTRIBUTION_PROGRESS_EVENT_KIND,
  CONTRIBUTION_STATES,
  FLAGGED_CORE_REVIEW_PROGRESS_EVENT_KIND,
  GENERATED_SPEC_PROGRESS_EVENT_KIND,
  IMPLEMENTATION_FAILED_CONTRIBUTION_STATE,
  INITIAL_CONTRIBUTION_STATE,
  MARKED_MERGED_PROGRESS_EVENT_KIND,
  MERGED_CONTRIBUTION_STATE,
  OPENED_VOTING_PROGRESS_EVENT_KIND,
  PREVIEW_DEPLOYING_CONTRIBUTION_STATE,
  PREVIEW_FAILED_CONTRIBUTION_STATE,
  PREVIEW_READY_CONTRIBUTION_STATE,
  PR_OPENED_CONTRIBUTION_STATE,
  QUEUED_IMPLEMENTATION_PROGRESS_EVENT_KIND,
  READY_FOR_VOTING_CONTRIBUTION_STATE,
  RECORDED_PREVIEW_DEPLOYMENT_PROGRESS_EVENT_KIND,
  RECORDED_PULL_REQUEST_PROGRESS_EVENT_KIND,
  REJECTED_CONTRIBUTION_PROGRESS_EVENT_KIND,
  REFINED_SPEC_PROGRESS_EVENT_KIND,
  REQUESTED_PREVIEW_CHANGES_PROGRESS_EVENT_KIND,
  REVISION_REQUESTED_CONTRIBUTION_STATE,
  SPEC_APPROVED_CONTRIBUTION_STATE,
  SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE,
  STARTED_CORE_REVIEW_PROGRESS_EVENT_KIND,
  STARTED_PRODUCTION_DEPLOY_PROGRESS_EVENT_KIND,
  VOTING_OPEN_CONTRIBUTION_STATE,
  validateCommentPayload,
  validateCommentDispositionPayload,
  validateContributionCreatePayload,
  validateContributionMessagePayload,
  validatePreviewReviewPayload,
  validatePreviewDeploymentPayload,
  validatePullRequestPayload,
  validateQueueImplementationPayload,
  validateSpecApprovalPayload,
  validateVotePayload,
} from '../shared/contracts.js';
import {
  DemoVideoError,
  getDemoVideoStatus,
  storeDemoVideoUpload,
} from './demo-video.js';
import {
  AttachmentUploadError,
  createMetadataOnlyAttachmentStorageKey,
  deleteStoredAttachment,
  isMetadataOnlyAttachmentStorageKey,
  storeContributionAttachmentUpload,
} from './attachments.js';
import { createConfiguredCompletionService } from './completion-service.js';
import {
  createConfiguredPreviewEvidenceService,
  isPreviewEvidenceServiceError,
} from './preview-evidence.js';
import { createConfiguredSpecService, isSpecServiceError } from './spec-service.js';

export { API_ROUTE_DEFINITIONS };

function buildResponse(status, body) {
  return {
    status,
    body,
  };
}

function buildRedirectResponse(status, location, headers = {}) {
  return {
    status,
    headers,
    location,
    responseMode: 'redirect',
  };
}

function buildEventStreamResponse({ status = 200, headers = {}, start }) {
  return {
    status,
    headers,
    responseMode: 'stream',
    start,
  };
}

function notWiredResponse(message = 'Persistence is not wired yet.') {
  return buildResponse(501, {
    error: 'not_wired',
    message,
  });
}

function specServiceErrorResponse(error) {
  if (isSpecServiceError(error)) {
    return buildResponse(error.statusCode, {
      error: error.code,
      message: error.message,
    });
  }

  return buildResponse(502, {
    error: 'spec_generation_failed',
    message: error instanceof Error ? error.message : 'Spec generation failed.',
  });
}

function previewEvidenceServiceErrorResponse(error) {
  if (isPreviewEvidenceServiceError(error)) {
    return buildResponse(error.statusCode, {
      error: error.code,
      message: error.message,
    });
  }

  return buildResponse(502, {
    error: 'preview_evidence_lookup_failed',
    message: error instanceof Error ? error.message : 'Preview evidence lookup failed.',
  });
}

function hasReadyPersistence(database, methodName) {
  return Boolean(database && database.connected === true && typeof database[methodName] === 'function');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeExecutionModeValue(value) {
  const rawValue = normalizeOptionalString(value);
  const normalized = rawValue.toLowerCase().replace(/[\s-]+/g, '_');

  switch (normalized) {
    case 'hosted':
    case 'remote_clone':
    case 'hosted_remote_clone':
      return 'hosted_remote_clone';
    case 'self_hosted':
    case 'self_hosted_worker':
    case 'selfhosted':
      return 'self_hosted';
    default:
      return rawValue;
  }
}

function hasOwnProperty(value, key) {
  return isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry, index, list) => entry.length > 0 && list.indexOf(entry) === index)
    : [];
}

function normalizeOptionalBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function normalizeOptionalPositiveInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeOptionalIntegerString(value) {
  const normalized =
    typeof value === 'number' && Number.isInteger(value) && value > 0
      ? String(value)
      : normalizeOptionalString(value);

  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : null;
}

function normalizeOriginValue(value) {
  const normalized = normalizeOptionalString(value);

  if (!normalized || normalized === 'null') {
    return '';
  }

  try {
    return new URL(normalized).origin;
  } catch {
    return '';
  }
}

function projectAllowsOrigin(project, origin) {
  const requestedOrigin = normalizeOriginValue(origin);

  if (!requestedOrigin) {
    return false;
  }

  const allowedOrigins = normalizeStringList(
    project?.allowedOrigins ?? project?.publicConfig?.allowedOrigins ?? [],
  );

  return allowedOrigins.some((entry) => normalizeOriginValue(entry) === requestedOrigin);
}

function deleteOrAssignString(target, key, value) {
  const normalized = normalizeOptionalString(value);

  if (normalized) {
    target[key] = normalized;
    return;
  }

  delete target[key];
}

function deleteOrAssignExecutionMode(target, key, value) {
  const normalized = normalizeExecutionModeValue(value);

  if (normalized) {
    target[key] = normalized;
    return;
  }

  delete target[key];
}

function serializeProjectRecord(project) {
  if (!isPlainObject(project)) {
    return project;
  }

  const nextProject = structuredClone(project);

  if (isPlainObject(nextProject.runtimeConfig)) {
    deleteOrAssignExecutionMode(nextProject.runtimeConfig, 'executionMode', nextProject.runtimeConfig.executionMode);
  }

  return nextProject;
}

function buildGitHubSettingsRedirectLocation({
  source,
  status,
  installationId = null,
  setupAction = null,
  error = null,
  errorDescription = null,
} = {}) {
  const searchParams = new URLSearchParams();
  searchParams.set('section', 'settings');

  if (source) {
    searchParams.set('github_source', source);
  }
  if (status) {
    searchParams.set('github_status', status);
  }
  if (installationId) {
    searchParams.set('github_installation_id', installationId);
  }
  if (setupAction) {
    searchParams.set('github_setup_action', setupAction);
  }
  if (error) {
    searchParams.set('github_error', error);
  }
  if (errorDescription) {
    searchParams.set('github_error_description', errorDescription);
  }

  return `/?${searchParams.toString()}`;
}

const GITHUB_PULL_REQUEST_SYNC_ACTIONS = new Set(['opened', 'reopened', 'synchronize', 'edited', 'ready_for_review', 'closed']);
const GITHUB_CONTRIBUTION_ID_IN_BODY_PATTERN = /Contribution ID:\s*`([^`]+)`/i;
const GITHUB_CONTRIBUTION_ID_IN_BRANCH_PATTERN =
  /^crowdship\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-|$)/i;

function parseContributionIdFromPullRequestBody(body) {
  const normalized = normalizeOptionalString(body);

  if (!normalized) {
    return null;
  }

  const match = normalized.match(GITHUB_CONTRIBUTION_ID_IN_BODY_PATTERN);
  return normalizeOptionalString(match?.[1]) || null;
}

function parseContributionIdFromBranchName(branchName) {
  const normalized = normalizeOptionalString(branchName);

  if (!normalized) {
    return null;
  }

  const match = normalized.match(GITHUB_CONTRIBUTION_ID_IN_BRANCH_PATTERN);
  return normalizeOptionalString(match?.[1]) || null;
}

function extractContributionIdFromGitHubPullRequest(pullRequest) {
  if (!isPlainObject(pullRequest)) {
    return null;
  }

  return (
    parseContributionIdFromPullRequestBody(pullRequest.body) ||
    parseContributionIdFromBranchName(pullRequest?.head?.ref) ||
    null
  );
}

function resolveGitHubPullRequestStatus(pullRequest) {
  if (!isPlainObject(pullRequest)) {
    return null;
  }

  if (normalizeOptionalString(pullRequest.merged_at) || normalizeOptionalBoolean(pullRequest.merged) === true) {
    return 'merged';
  }

  return normalizeOptionalString(pullRequest.state).toLowerCase() === 'closed' ? 'closed' : 'open';
}

function mergeGitHubPullRequestMetadata(existingMetadata, patch) {
  const current = isPlainObject(existingMetadata) ? existingMetadata : {};
  const next = isPlainObject(patch) ? patch : {};
  return {
    ...current,
    githubWebhook: {
      ...(isPlainObject(current.githubWebhook) ? current.githubWebhook : {}),
      ...next,
    },
  };
}

async function syncGitHubPullRequestWebhook({
  action,
  body,
  database,
  deliveryId,
  event,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  if (!GITHUB_PULL_REQUEST_SYNC_ACTIONS.has(action)) {
    return {
      status: 'ignored',
      reason: 'unsupported_action',
    };
  }

  if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
    return {
      status: 'ignored',
      reason: 'persistence_unavailable',
    };
  }

  const pullRequest = isPlainObject(body?.pull_request) ? body.pull_request : null;

  if (!pullRequest) {
    return {
      status: 'ignored',
      reason: 'missing_pull_request',
    };
  }

  const contributionId = extractContributionIdFromGitHubPullRequest(pullRequest);

  if (!contributionId) {
    return {
      status: 'ignored',
      reason: 'contribution_not_identified',
    };
  }

  const detail = await database.getContributionDetail(contributionId);

  if (!detail) {
    return {
      status: 'ignored',
      reason: 'contribution_not_found',
      contributionId,
    };
  }

  const repositoryFullName =
    normalizeOptionalString(body?.repository?.full_name) ||
    normalizeOptionalString(pullRequest?.base?.repo?.full_name) ||
    normalizeOptionalString(pullRequest?.head?.repo?.full_name);
  const pullRequestNumber = normalizeOptionalPositiveInteger(pullRequest.number) ?? normalizeOptionalPositiveInteger(body?.number);
  const pullRequestStatus = resolveGitHubPullRequestStatus(pullRequest);
  const branchName = normalizeOptionalString(pullRequest?.head?.ref);
  const headSha = normalizeOptionalString(pullRequest?.head?.sha) || null;
  const url = normalizeOptionalString(pullRequest?.html_url);
  const updatedAt = normalizeOptionalString(pullRequest?.updated_at) || clock().toISOString();

  if (!repositoryFullName || !pullRequestNumber || !pullRequestStatus || !branchName || !url) {
    return {
      status: 'ignored',
      reason: 'invalid_pull_request_payload',
      contributionId,
    };
  }

  const existingPullRequest =
    asArray(detail.pullRequests).find(
      (entry) =>
        entry.repositoryFullName === repositoryFullName &&
        entry.number === pullRequestNumber,
    ) ??
    asArray(detail.pullRequests).find((entry) => normalizeOptionalString(entry.branchName) === branchName) ??
    null;
  const metadata = mergeGitHubPullRequestMetadata(existingPullRequest?.metadata, {
    action,
    deliveryId,
    event,
    mergedAt: normalizeOptionalString(pullRequest?.merged_at) || null,
    mergedBy: normalizeOptionalString(pullRequest?.merged_by?.login) || null,
    updatedAt,
  });
  const mergedStateIndex = getContributionStateIndex(MERGED_CONTRIBUTION_STATE);
  const currentStateIndex = getContributionStateIndex(detail.contribution.state);
  const shouldRecordMergedEvent =
    pullRequestStatus === 'merged' &&
    (currentStateIndex === -1 || mergedStateIndex === -1 || currentStateIndex < mergedStateIndex);
  const nextState =
    pullRequestStatus === 'merged'
      ? advanceContributionState(detail.contribution.state, MERGED_CONTRIBUTION_STATE)
      : existingPullRequest
        ? detail.contribution.state
        : pullRequestStatus === 'open'
          ? resolveContributionState(detail.contribution.state, PR_OPENED_CONTRIBUTION_STATE)
          : detail.contribution.state;
  const progressEvents =
    shouldRecordMergedEvent
      ? [
          {
            id: idFactory(),
            contributionId,
            kind: MARKED_MERGED_PROGRESS_EVENT_KIND,
            status: nextState,
            message: `Merged from PR #${pullRequestNumber}.`,
            externalUrl: url,
            payload: {
              contributionId,
              repositoryFullName,
              number: pullRequestNumber,
            },
            createdAt: updatedAt,
          },
        ]
      : !existingPullRequest
        ? [
            {
              id: idFactory(),
              contributionId,
              kind: RECORDED_PULL_REQUEST_PROGRESS_EVENT_KIND,
              status: nextState,
              message: `PR #${pullRequestNumber} recorded from GitHub.`,
              externalUrl: url,
              payload: {
                contributionId,
                repositoryFullName,
                number: pullRequestNumber,
              },
              createdAt: updatedAt,
            },
          ]
        : [];
  const updated = await database.applyContributionUpdate({
    contributionId,
    nextState,
    updatedAt,
    pullRequests: existingPullRequest
      ? []
      : [
          {
            id: idFactory(),
            contributionId,
            repositoryFullName,
            number: pullRequestNumber,
            url,
            branchName,
            headSha,
            status: pullRequestStatus,
            metadata,
            createdAt: updatedAt,
            updatedAt,
          },
        ],
    updatedPullRequests: existingPullRequest
      ? [
          {
            ...existingPullRequest,
            repositoryFullName,
            number: pullRequestNumber,
            url,
            branchName,
            headSha,
            status: pullRequestStatus,
            metadata,
            updatedAt,
          },
        ]
      : [],
    progressEvents,
  });

  return {
    status: 'applied',
    contributionId,
    pullRequestNumber,
    pullRequestStatus,
    contributionState: updated?.contribution?.state ?? nextState,
  };
}

function resolveProjectRuntimeConfig(project, { repositoryFullName = null } = {}) {
  const runtimeConfig = isPlainObject(project?.runtimeConfig) ? structuredClone(project.runtimeConfig) : {};
  const resolvedRepositoryFullName = normalizeOptionalString(repositoryFullName) || normalizeOptionalString(runtimeConfig.repositoryFullName);
  deleteOrAssignExecutionMode(runtimeConfig, 'executionMode', runtimeConfig.executionMode);

  if (resolvedRepositoryFullName) {
    runtimeConfig.repositoryFullName = resolvedRepositoryFullName;
  } else {
    delete runtimeConfig.repositoryFullName;
  }

  return runtimeConfig;
}

function validateProjectPayload(payload, projectSlug) {
  if (!isPlainObject(payload)) {
    return {
      ok: false,
      errors: ['payload must be an object'],
    };
  }

  const wrappedProject = hasOwnProperty(payload, 'project') ? payload.project : undefined;

  if (wrappedProject !== undefined && !isPlainObject(wrappedProject)) {
    return {
      ok: false,
      errors: ['project must be an object when provided'],
    };
  }

  const source = isPlainObject(wrappedProject) ? wrappedProject : payload;
  const errors = [];

  if (hasOwnProperty(source, 'slug')) {
    const slug = normalizeOptionalString(source.slug);

    if (!slug) {
      errors.push('slug must be a non-empty string');
    } else if (slug !== projectSlug) {
      errors.push('slug must match the project route');
    }
  }

  if (hasOwnProperty(source, 'name') && !normalizeOptionalString(source.name)) {
    errors.push('name must be a non-empty string when provided');
  }

  if (hasOwnProperty(source, 'allowedOrigins') && !Array.isArray(source.allowedOrigins)) {
    errors.push('allowedOrigins must be an array when provided');
  }

  if (hasOwnProperty(source, 'publicConfig') && !isPlainObject(source.publicConfig)) {
    errors.push('publicConfig must be an object when provided');
  }

  if (hasOwnProperty(source, 'runtimeConfig') && !isPlainObject(source.runtimeConfig)) {
    errors.push('runtimeConfig must be an object when provided');
  }

  if (isPlainObject(source.publicConfig)) {
    if (hasOwnProperty(source.publicConfig, 'allowedOrigins') && !Array.isArray(source.publicConfig.allowedOrigins)) {
      errors.push('publicConfig.allowedOrigins must be an array when provided');
    }

    if (
      hasOwnProperty(source.publicConfig, 'contributionStates') &&
      !Array.isArray(source.publicConfig.contributionStates)
    ) {
      errors.push('publicConfig.contributionStates must be an array when provided');
    }
  }

  return errors.length === 0
    ? {
        ok: true,
        value: source,
      }
    : {
        ok: false,
        errors,
      };
}

function buildProjectRecordFromPayload(source, projectSlug, existingProject = null) {
  const existingPublicConfig = isPlainObject(existingProject?.publicConfig)
    ? structuredClone(existingProject.publicConfig)
    : {};
  const existingRuntimeConfig = isPlainObject(existingProject?.runtimeConfig)
    ? structuredClone(existingProject.runtimeConfig)
    : {};
  const inputPublicConfig = isPlainObject(source.publicConfig) ? source.publicConfig : {};
  const inputRuntimeConfig = isPlainObject(source.runtimeConfig) ? source.runtimeConfig : {};
  const allowedOrigins = hasOwnProperty(source, 'allowedOrigins')
    ? normalizeStringList(source.allowedOrigins)
    : hasOwnProperty(inputPublicConfig, 'allowedOrigins')
      ? normalizeStringList(inputPublicConfig.allowedOrigins)
      : normalizeStringList(existingProject?.allowedOrigins ?? existingPublicConfig.allowedOrigins);
  const contributionStates = hasOwnProperty(inputPublicConfig, 'contributionStates')
    ? normalizeStringList(inputPublicConfig.contributionStates)
    : normalizeStringList(existingPublicConfig.contributionStates);
  const widgetScriptCandidate = hasOwnProperty(inputPublicConfig, 'widgetScriptUrl')
    ? inputPublicConfig.widgetScriptUrl
    : hasOwnProperty(source, 'widgetScriptUrl')
      ? source.widgetScriptUrl
      : existingPublicConfig.widgetScriptUrl;
  const runtimeConfig = {
    ...existingRuntimeConfig,
    ...structuredClone(inputRuntimeConfig),
  };
  deleteOrAssignExecutionMode(runtimeConfig, 'executionMode', runtimeConfig.executionMode);

  if (hasOwnProperty(source, 'executionMode')) {
    deleteOrAssignExecutionMode(runtimeConfig, 'executionMode', source.executionMode);
  }
  if (hasOwnProperty(source, 'automationPolicy')) {
    deleteOrAssignString(runtimeConfig, 'automationPolicy', source.automationPolicy);
  }
  if (hasOwnProperty(source, 'repositoryFullName')) {
    deleteOrAssignString(runtimeConfig, 'repositoryFullName', source.repositoryFullName);
  }
  if (hasOwnProperty(source, 'repoPath')) {
    deleteOrAssignString(runtimeConfig, 'repoPath', source.repoPath);
  }
  if (hasOwnProperty(source, 'defaultBranch')) {
    deleteOrAssignString(runtimeConfig, 'defaultBranch', source.defaultBranch);
  }
  if (hasOwnProperty(source, 'previewDeployScript')) {
    deleteOrAssignString(runtimeConfig, 'previewDeployScript', source.previewDeployScript);
  }
  if (hasOwnProperty(source, 'previewBaseUrl')) {
    deleteOrAssignString(runtimeConfig, 'previewBaseUrl', source.previewBaseUrl);
  }
  if (hasOwnProperty(source, 'previewPathTemplate')) {
    deleteOrAssignString(runtimeConfig, 'previewUrlPattern', source.previewPathTemplate);
  }
  if (hasOwnProperty(source, 'productionUrl')) {
    deleteOrAssignString(runtimeConfig, 'productionBaseUrl', source.productionUrl);
  }
  if (hasOwnProperty(source, 'implementationProfile')) {
    deleteOrAssignString(runtimeConfig, 'implementationProfile', source.implementationProfile);
  }

  return {
    slug: projectSlug,
    name: normalizeOptionalString(source.name) || normalizeOptionalString(existingProject?.name) || projectSlug,
    allowedOrigins,
    publicConfig: {
      ...existingPublicConfig,
      project: projectSlug,
      widgetScriptUrl: normalizeOptionalString(widgetScriptCandidate) || null,
      allowedOrigins,
      contributionStates,
    },
    runtimeConfig,
  };
}

const MAX_CLARIFICATION_ANSWERS = 3;

function formatSentence(value, fallback) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

  if (!text) {
    return fallback;
  }

  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function humanizeSelection(context = {}) {
  const selectedObjectType = typeof context.selectedObjectType === 'string' ? context.selectedObjectType.trim() : '';
  const selectedObjectId = typeof context.selectedObjectId === 'string' ? context.selectedObjectId.trim() : '';

  if (!selectedObjectType && !selectedObjectId) {
    return 'current mission context';
  }

  return [selectedObjectType, selectedObjectId].filter(Boolean).join(' ');
}

function createAttachmentRecord(attachment, contributionId, createdAt, idFactory) {
  return {
    id: idFactory(),
    contributionId,
    kind: attachment.kind,
    filename: attachment.filename,
    contentType: attachment.contentType,
    sizeBytes: Number(attachment.sizeBytes),
    storageKey: createMetadataOnlyAttachmentStorageKey(contributionId, attachment.filename),
    createdAt,
  };
}

function createUserMessage({ id, contributionId, body, createdAt, messageType = 'request' }) {
  return {
    id,
    contributionId,
    authorRole: 'requester',
    messageType,
    body,
    choices: null,
    metadata: null,
    createdAt,
  };
}

function createAgentMessage({
  id,
  contributionId,
  body,
  createdAt,
  metadata = null,
  messageType = 'spec_ready',
  choices = null,
}) {
  return {
    id,
    contributionId,
    authorRole: 'agent',
    messageType,
    body,
    choices,
    metadata,
    createdAt,
  };
}

function countClarificationAnswers(messages) {
  return asArray(messages).filter(
    (message) =>
      message?.authorRole === 'requester' && message?.messageType === 'clarification_answer',
  ).length;
}

function buildAcceptanceCriteria({ contribution, attachments, revisionNote }) {
  const payload = contribution.payload ?? {};
  const context = payload.context ?? {};
  const criteria = [];

  if (payload.route) {
    criteria.push(`The change is available from ${payload.route}.`);
  }

  criteria.push(`The workflow keeps the ${humanizeSelection(context)} in context while the request is used.`);

  if (attachments.length > 0) {
    criteria.push('The implementation respects the attached reference material.');
  }

  if (revisionNote) {
    criteria.push(formatSentence(`The updated scope addresses this requester note: ${revisionNote}`, 'The updated scope addresses the requester refinement.'));
  }

  criteria.push('Failures keep the requester on the same route with a clear recovery path.');

  if (contribution.type === 'bug_report') {
    criteria.push('The broken path has an explicit fix and does not regress the surrounding mission flow.');
  } else {
    criteria.push('The requested outcome is visible in the primary mission workflow without extra setup.');
  }

  return criteria.slice(0, 5);
}

function buildNonGoals(contribution) {
  const nonGoals = [
    'New authentication or permission tiers.',
    'Backoffice-only controls that do not affect the requester flow.',
  ];

  if (contribution.type === 'bug_report') {
    nonGoals.push('A broader redesign of unrelated mission-control surfaces.');
  } else {
    nonGoals.push('A full replay or telemetry architecture rewrite outside the requested flow.');
  }

  return nonGoals.slice(0, 3);
}

function readOptionalLifecycleNote(body) {
  if (!isPlainObject(body)) {
    return '';
  }

  return normalizeOptionalString(body.note);
}

function buildCompletionSummary(detail, mergedPullRequest, note = '') {
  const route = normalizeOptionalString(detail?.contribution?.payload?.route);
  const title = normalizeOptionalString(detail?.contribution?.title) || 'This change';
  const summaryLines = [`${title} is now live${route ? ` on ${route}` : ''}.`];

  if (mergedPullRequest?.number) {
    summaryLines.push(`It shipped from PR #${mergedPullRequest.number}.`);
  }

  if (note) {
    summaryLines.push(formatSentence(note, note));
  } else {
    summaryLines.push('The approved preview and review notes are now reflected in production.');
  }

  return summaryLines.join(' ');
}

function buildSpecVersionRecord({
  id,
  contribution,
  versionNumber,
  attachments,
  createdAt,
  revisionNote = null,
  generatedSpec = null,
}) {
  const goal = formatSentence(
    generatedSpec?.goal ??
      (revisionNote
        ? `Update ${contribution.title} with the latest requester refinement`
        : contribution.title),
    'Clarify the requested product change.',
  );
  const userProblem = formatSentence(
    generatedSpec?.userProblem ??
      (revisionNote
        ? `${contribution.body ?? contribution.title} Latest refinement: ${revisionNote}`
        : contribution.body ?? contribution.title),
    'The requester needs a clearer product outcome.',
  );

  return {
    id,
    contributionId: contribution.id,
    versionNumber,
    title: contribution.title,
    goal,
    userProblem,
    spec: {
      acceptanceCriteria:
        Array.isArray(generatedSpec?.acceptanceCriteria) && generatedSpec.acceptanceCriteria.length > 0
          ? generatedSpec.acceptanceCriteria.map((item) =>
              formatSentence(item, 'The requested outcome is visible in the primary mission workflow.'),
            )
          : buildAcceptanceCriteria({
              contribution,
              attachments,
              revisionNote,
            }),
      nonGoals:
        Array.isArray(generatedSpec?.nonGoals) && generatedSpec.nonGoals.length > 0
          ? generatedSpec.nonGoals.map((item) =>
              formatSentence(item, 'Avoid unrelated workflow changes.'),
            )
          : buildNonGoals(contribution),
      affectedRoute: contribution.payload?.route ?? null,
      affectedContext: contribution.payload?.context ?? null,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        kind: attachment.kind,
      })),
      revisionNote,
    },
    approvedAt: null,
    createdAt,
  };
}

function serializeContribution(contribution) {
  return {
    id: contribution.id,
    projectSlug: contribution.projectSlug,
    environment: contribution.environment,
    type: contribution.type,
    title: contribution.title,
    body: contribution.body ?? null,
    state: contribution.state,
    payload: contribution.payload,
    createdAt: contribution.createdAt,
    updatedAt: contribution.updatedAt,
  };
}

function serializeProgressEvent(event) {
  return {
    id: event.id,
    contributionId: event.contributionId,
    kind: event.kind,
    status: event.status,
    message: event.message,
    externalUrl: event.externalUrl ?? null,
    payload: event.payload ?? null,
    createdAt: event.createdAt,
  };
}

function serializeAttachment(attachment) {
  return {
    id: attachment.id,
    contributionId: attachment.contributionId,
    kind: attachment.kind,
    filename: attachment.filename,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    storageKey: attachment.storageKey,
    createdAt: attachment.createdAt,
  };
}

function serializeMessage(message) {
  return {
    id: message.id,
    contributionId: message.contributionId,
    authorRole: message.authorRole,
    messageType: message.messageType,
    body: message.body,
    choices: message.choices ?? null,
    metadata: message.metadata ?? null,
    createdAt: message.createdAt,
  };
}

function serializeSpecVersion(specVersion) {
  const spec = specVersion.spec ?? {};

  return {
    id: specVersion.id,
    contributionId: specVersion.contributionId,
    versionNumber: specVersion.versionNumber,
    title: specVersion.title,
    goal: specVersion.goal,
    userProblem: specVersion.userProblem,
    acceptanceCriteria: asArray(spec.acceptanceCriteria),
    nonGoals: asArray(spec.nonGoals),
    affectedRoute: spec.affectedRoute ?? null,
    affectedContext: spec.affectedContext ?? null,
    attachments: asArray(spec.attachments),
    revisionNote: spec.revisionNote ?? null,
    approvedAt: specVersion.approvedAt ?? null,
    createdAt: specVersion.createdAt,
  };
}

function getLatestSpecVersion(specVersions) {
  return asArray(specVersions)
    .slice()
    .sort((left, right) => right.versionNumber - left.versionNumber)[0] ?? null;
}

function getLatestByCreatedAt(records) {
  return asArray(records)
    .slice()
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0] ?? null;
}

function getContributionStateIndex(state) {
  return CONTRIBUTION_STATES.indexOf(state);
}

function advanceContributionState(currentState, candidateState) {
  if (!candidateState) {
    return currentState;
  }

  const currentIndex = getContributionStateIndex(currentState);
  const candidateIndex = getContributionStateIndex(candidateState);

  if (currentIndex === -1 || candidateIndex === -1) {
    return candidateState;
  }

  return candidateIndex > currentIndex ? candidateState : currentState;
}

const RETRYABLE_DELIVERY_STATES = new Set([
  IMPLEMENTATION_FAILED_CONTRIBUTION_STATE,
  PREVIEW_FAILED_CONTRIBUTION_STATE,
  REVISION_REQUESTED_CONTRIBUTION_STATE,
]);

const DELIVERY_REENTRY_STATES = new Set([
  AGENT_QUEUED_CONTRIBUTION_STATE,
  PR_OPENED_CONTRIBUTION_STATE,
  PREVIEW_DEPLOYING_CONTRIBUTION_STATE,
  PREVIEW_FAILED_CONTRIBUTION_STATE,
  PREVIEW_READY_CONTRIBUTION_STATE,
]);

function resolveContributionState(currentState, candidateState) {
  if (RETRYABLE_DELIVERY_STATES.has(currentState) && DELIVERY_REENTRY_STATES.has(candidateState)) {
    return candidateState;
  }

  return advanceContributionState(currentState, candidateState);
}

const OWNER_CLARIFICATION_REQUESTABLE_STATES = new Set([
  SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE,
  SPEC_APPROVED_CONTRIBUTION_STATE,
  IMPLEMENTATION_FAILED_CONTRIBUTION_STATE,
  PREVIEW_FAILED_CONTRIBUTION_STATE,
  PREVIEW_READY_CONTRIBUTION_STATE,
  'requester_review',
  REVISION_REQUESTED_CONTRIBUTION_STATE,
  READY_FOR_VOTING_CONTRIBUTION_STATE,
  VOTING_OPEN_CONTRIBUTION_STATE,
  'core_team_flagged',
  'core_review',
]);

const OWNER_ARCHIVEABLE_STATES = new Set(
  CONTRIBUTION_STATES.filter((state) => !['completed', 'rejected'].includes(state)),
);

function serializeImplementationJob(job) {
  return {
    id: job.id,
    contributionId: job.contributionId,
    status: job.status,
    queueName: job.queueName,
    branchName: job.branchName ?? null,
    repositoryFullName: job.repositoryFullName ?? null,
    githubRunId: job.githubRunId ?? null,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
    errorSummary: job.errorSummary ?? null,
    metadata: job.metadata ?? null,
    createdAt: job.createdAt,
  };
}

function serializePullRequest(record) {
  return {
    id: record.id,
    contributionId: record.contributionId,
    repositoryFullName: record.repositoryFullName,
    number: record.number,
    url: record.url,
    branchName: record.branchName,
    headSha: record.headSha ?? null,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function serializePreviewDeployment(record) {
  return {
    id: record.id,
    contributionId: record.contributionId,
    pullRequestId: record.pullRequestId ?? null,
    url: record.url,
    status: record.status,
    gitSha: record.gitSha ?? null,
    deployKind: record.deployKind,
    deployedAt: record.deployedAt ?? null,
    checkedAt: record.checkedAt ?? null,
    errorSummary: record.errorSummary ?? null,
    createdAt: record.createdAt,
  };
}

function serializeVote(record) {
  return {
    id: record.id,
    contributionId: record.contributionId,
    voterUserId: record.voterUserId ?? null,
    voterEmail: record.voterEmail ?? null,
    voteType: record.voteType,
    createdAt: record.createdAt,
  };
}

function serializeComment(record) {
  return {
    id: record.id,
    contributionId: record.contributionId,
    authorUserId: record.authorUserId ?? null,
    authorRole: record.authorRole,
    body: record.body,
    disposition: record.disposition,
    createdAt: record.createdAt,
  };
}

function summarizeVotes(votes) {
  const summary = {
    approve: 0,
    block: 0,
    total: 0,
  };

  for (const vote of asArray(votes)) {
    if (vote.voteType === 'approve') {
      summary.approve += 1;
    } else if (vote.voteType === 'block') {
      summary.block += 1;
    }
    summary.total += 1;
  }

  return summary;
}

function deriveContributionAdminBucket(contribution, implementationJobs = [], previewDeployments = []) {
  const latestImplementationJob = getLatestByCreatedAt(implementationJobs);
  const latestPreviewDeployment = getLatestByCreatedAt(previewDeployments);

  if (
    contribution.state === IMPLEMENTATION_FAILED_CONTRIBUTION_STATE ||
    contribution.state === REVISION_REQUESTED_CONTRIBUTION_STATE ||
    contribution.state === PREVIEW_FAILED_CONTRIBUTION_STATE ||
    latestImplementationJob?.status === 'failed' ||
    latestPreviewDeployment?.status === 'failed'
  ) {
    return 'attention';
  }

  if (contribution.state === MERGED_CONTRIBUTION_STATE || contribution.state === 'completed' || contribution.state === 'rejected') {
    return 'done';
  }

  if (
    contribution.state === AGENT_QUEUED_CONTRIBUTION_STATE ||
    contribution.state === 'agent_running' ||
    contribution.state === PR_OPENED_CONTRIBUTION_STATE ||
    contribution.state === PREVIEW_DEPLOYING_CONTRIBUTION_STATE ||
    latestImplementationJob?.status === 'queued' ||
    latestImplementationJob?.status === 'running' ||
    latestPreviewDeployment?.status === 'deploying'
  ) {
    return 'active';
  }

  if (
    contribution.state === SPEC_APPROVED_CONTRIBUTION_STATE ||
    contribution.state === PREVIEW_READY_CONTRIBUTION_STATE ||
    contribution.state === 'requester_review' ||
    contribution.state === 'ready_for_voting' ||
    contribution.state === VOTING_OPEN_CONTRIBUTION_STATE ||
    contribution.state === 'core_team_flagged' ||
    contribution.state === 'core_review'
  ) {
    return 'ready';
  }

  return 'waiting';
}

function buildContributionSnapshot(detail) {
  const attachments = asArray(detail.attachments);
  const messages = asArray(detail.messages);
  const specVersions = asArray(detail.specVersions);
  const progressEvents = asArray(detail.progressEvents);
  const implementationJobs = asArray(detail.implementationJobs);
  const pullRequests = asArray(detail.pullRequests);
  const previewDeployments = asArray(detail.previewDeployments);
  const votes = asArray(detail.votes);
  const comments = asArray(detail.comments);
  const latestSpec = getLatestSpecVersion(specVersions);
  const currentImplementationJob = getLatestByCreatedAt(implementationJobs);

  return {
    contribution: serializeContribution(detail.contribution),
    attachments: attachments.map(serializeAttachment),
    conversation: messages.map(serializeMessage),
    spec: {
      current: latestSpec ? serializeSpecVersion(latestSpec) : null,
      versions: specVersions.map(serializeSpecVersion),
    },
    lifecycle: {
      currentState: detail.contribution.state,
      events: progressEvents.map(serializeProgressEvent),
    },
    review: {
      implementation: {
        current: currentImplementationJob ? serializeImplementationJob(currentImplementationJob) : null,
        jobs: implementationJobs.map(serializeImplementationJob),
      },
      pullRequests: pullRequests.map(serializePullRequest),
      previewDeployments: previewDeployments.map(serializePreviewDeployment),
      votes: {
        summary: summarizeVotes(votes),
        items: votes.map(serializeVote),
      },
      comments: comments.map(serializeComment),
    },
  };
}

function buildContributionProgressStreamPayload(detail) {
  const snapshot = buildContributionSnapshot(detail);

  return {
    contributionId: detail.contribution.id,
    contribution: snapshot.contribution,
    lifecycle: snapshot.lifecycle,
    contributionDetail: snapshot,
  };
}

function buildQueuedImplementationArtifacts({
  detail,
  projectRuntimeConfig,
  createdAt,
  idFactory,
  queueName = 'default',
  branchName = null,
  note = null,
  message = 'Implementation queued.',
}) {
  const repositoryFullName = normalizeOptionalString(projectRuntimeConfig?.repositoryFullName) || null;
  const metadata = {
    projectRuntimeConfig,
  };

  if (note) {
    metadata.note = note;
  }

  const implementationJob = {
    id: idFactory(),
    contributionId: detail.contribution.id,
    status: 'queued',
    queueName,
    branchName,
    repositoryFullName,
    githubRunId: null,
    startedAt: null,
    finishedAt: null,
    errorSummary: null,
    metadata,
    createdAt,
  };
  const nextState = resolveContributionState(detail.contribution.state, AGENT_QUEUED_CONTRIBUTION_STATE);
  const progressEvent = {
    id: idFactory(),
    contributionId: detail.contribution.id,
    kind: QUEUED_IMPLEMENTATION_PROGRESS_EVENT_KIND,
    status: nextState,
    message,
    externalUrl: null,
    payload: {
      contributionId: detail.contribution.id,
      implementationJobId: implementationJob.id,
      queueName: implementationJob.queueName,
      repositoryFullName,
    },
    createdAt,
  };

  return {
    nextState,
    implementationJob,
    progressEvent,
  };
}

function writeEventStreamEvent(response, { event = 'message', id = null, data = null }) {
  if (!response || response.writableEnded || response.destroyed) {
    return;
  }

  const lines = [];

  if (id) {
    lines.push(`id: ${id}`);
  }

  if (event) {
    lines.push(`event: ${event}`);
  }

  if (data != null) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    payload.split('\n').forEach((line) => {
      lines.push(`data: ${line}`);
    });
  }

  response.write(`${lines.join('\n')}\n\n`);
}

function canQueueImplementationFromState(state) {
  return [
    SPEC_APPROVED_CONTRIBUTION_STATE,
    REVISION_REQUESTED_CONTRIBUTION_STATE,
    IMPLEMENTATION_FAILED_CONTRIBUTION_STATE,
    PREVIEW_FAILED_CONTRIBUTION_STATE,
  ].includes(state);
}

function serializeContributionSummary(
  contribution,
  specVersions = [],
  implementationJobs = [],
  pullRequests = [],
  previewDeployments = [],
) {
  const latestSpec = getLatestSpecVersion(specVersions);
  const latestImplementationJob = getLatestByCreatedAt(implementationJobs);
  const latestPullRequest = getLatestByCreatedAt(pullRequests);
  const latestPreviewDeployment = getLatestByCreatedAt(previewDeployments);

  return {
    ...serializeContribution(contribution),
    latestSpecVersion: latestSpec?.versionNumber ?? null,
    specApprovedAt: latestSpec?.approvedAt ?? null,
    latestImplementationJob: latestImplementationJob ? serializeImplementationJob(latestImplementationJob) : null,
    latestPullRequest: latestPullRequest ? serializePullRequest(latestPullRequest) : null,
    latestPreviewDeployment: latestPreviewDeployment ? serializePreviewDeployment(latestPreviewDeployment) : null,
    adminBucket: deriveContributionAdminBucket(contribution, implementationJobs, previewDeployments),
  };
}

export function createHealthHandler() {
  return () =>
    buildResponse(200, {
      ok: true,
      service: 'crowdship-api',
      version: 'v1',
    });
}

export function createDemoVideoStatusHandler() {
  return () => buildResponse(200, getDemoVideoStatus());
}

export function createDemoVideoUploadHandler() {
  return async ({ request } = {}) => {
    try {
      return buildResponse(201, await storeDemoVideoUpload(request));
    } catch (error) {
      if (error instanceof DemoVideoError) {
        return buildResponse(error.statusCode, {
          error: error.code,
          message: error.message,
        });
      }

      return buildResponse(500, {
        error: 'demo_video_upload_failed',
        message: error instanceof Error ? error.message : 'Demo video upload failed.',
      });
    }
  };
}

export function createProjectPublicConfigHandler({ database } = {}) {
  return async ({ params = {} } = {}) => {
    if (!hasReadyPersistence(database, 'getProjectPublicConfig')) {
      return notWiredResponse('Project persistence is not wired yet.');
    }

    const config = await database.getProjectPublicConfig(params.project);

    if (!config) {
      return buildResponse(404, {
        error: 'project_not_found',
        project: params.project ?? null,
      });
    }

    return buildResponse(200, config);
  };
}

export function createProjectHandler({ database } = {}) {
  return async ({ params = {} } = {}) => {
    const projectSlug = normalizeOptionalString(params.project);

    if (!projectSlug) {
      return buildResponse(400, {
        error: 'invalid_project_slug',
        message: 'Project slug is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getProject')) {
      return notWiredResponse('Project persistence is not wired yet.');
    }

    const project = await database.getProject(projectSlug);

    if (!project) {
      return buildResponse(404, {
        error: 'project_not_found',
        project: projectSlug,
      });
    }

    return buildResponse(200, {
      project: serializeProjectRecord(project),
    });
  };
}

export function createProjectGitHubConnectionHandler({ database, fetchImpl = fetch } = {}) {
  return async ({ params = {} } = {}) => {
    const projectSlug = normalizeOptionalString(params.project);

    if (!projectSlug) {
      return buildResponse(400, {
        error: 'invalid_project_slug',
        message: 'Project slug is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getProject')) {
      return notWiredResponse('Project persistence is not wired yet.');
    }

    const project = await database.getProject(projectSlug);

    if (!project) {
      return buildResponse(404, {
        error: 'project_not_found',
        project: projectSlug,
      });
    }

    const runtimeConfig = resolveProjectRuntimeConfig(project);
    const repositoryFullName = normalizeOptionalString(runtimeConfig.repositoryFullName) || null;
    const executionMode = normalizeExecutionModeValue(runtimeConfig.executionMode);
    const appConfig = getGitHubAppConfig();
    const responsePayload = {
      project: projectSlug,
      githubConnection: {
        status: 'unconfigured',
        message: 'GitHub App credentials are not configured on the Crowdship host.',
        executionMode: executionMode || null,
        repositoryFullName,
        appConfigured: Boolean(appConfig),
        appSlug: null,
        appName: null,
        appUrl: null,
        installUrl: null,
        ownerLogin: null,
        installationId: null,
        accountLogin: null,
        repositorySelection: null,
      },
    };

    if (executionMode === 'self_hosted') {
      responsePayload.githubConnection.status = 'not_required';
      responsePayload.githubConnection.message =
        'Self-hosted worker mode uses customer-side credentials, so the hosted GitHub App is optional.';
      return buildResponse(200, responsePayload);
    }

    if (!repositoryFullName) {
      responsePayload.githubConnection.status = 'missing_repository';
      responsePayload.githubConnection.message =
        'Set the target repository before checking the hosted GitHub App connection.';
      return buildResponse(200, responsePayload);
    }

    if (!appConfig) {
      return buildResponse(200, responsePayload);
    }

    try {
      const metadata = await getGitHubAppMetadata({
        config: appConfig,
        fetchImpl,
      });
      responsePayload.githubConnection.appSlug = metadata.slug;
      responsePayload.githubConnection.appName = metadata.name;
      responsePayload.githubConnection.appUrl = metadata.htmlUrl;
      responsePayload.githubConnection.ownerLogin = metadata.ownerLogin;
      responsePayload.githubConnection.installUrl = metadata.slug
        ? `https://github.com/apps/${encodeURIComponent(metadata.slug)}/installations/new`
        : null;
    } catch (error) {
      return buildResponse(502, {
        error: 'github_app_lookup_failed',
        message: error instanceof Error ? error.message : 'Could not load GitHub App metadata.',
      });
    }

    try {
      const installation = await getGitHubAppInstallationForRepository({
        repositoryFullName,
        config: appConfig,
        fetchImpl,
      });
      responsePayload.githubConnection.status = 'connected';
      responsePayload.githubConnection.message =
        'GitHub App credentials are live and the target repository is installed.';
      responsePayload.githubConnection.installationId = installation.id;
      responsePayload.githubConnection.accountLogin = installation.accountLogin;
      responsePayload.githubConnection.repositorySelection = installation.repositorySelection;
      return buildResponse(200, responsePayload);
    } catch (error) {
      if (isGitHubApiError(error) && error.status === 404) {
        responsePayload.githubConnection.status = 'not_installed';
        responsePayload.githubConnection.message =
          `The GitHub App exists, but it is not installed on ${repositoryFullName}.`;
        return buildResponse(200, responsePayload);
      }

      return buildResponse(502, {
        error: 'github_installation_lookup_failed',
        message: error instanceof Error ? error.message : 'Could not check the GitHub App installation.',
      });
    }
  };
}

export function createGitHubAppSetupHandler() {
  return async ({ query = {} } = {}) => {
    const installationId = normalizeOptionalIntegerString(query.installation_id);
    const setupAction = normalizeOptionalString(query.setup_action) || 'install';

    return buildRedirectResponse(
      303,
      buildGitHubSettingsRedirectLocation({
        source: 'setup',
        status: 'complete',
        installationId,
        setupAction,
      }),
    );
  };
}

export function createGitHubAppCallbackHandler() {
  return async ({ query = {} } = {}) => {
    const installationId = normalizeOptionalIntegerString(query.installation_id);
    const setupAction = normalizeOptionalString(query.setup_action) || null;
    const error = normalizeOptionalString(query.error);
    const errorDescription = normalizeOptionalString(query.error_description);

    if (error) {
      return buildRedirectResponse(
        303,
        buildGitHubSettingsRedirectLocation({
          source: 'callback',
          status: 'error',
          installationId,
          setupAction,
          error,
          errorDescription,
        }),
      );
    }

    return buildRedirectResponse(
      303,
      buildGitHubSettingsRedirectLocation({
        source: 'callback',
        status: 'received',
        installationId,
        setupAction,
      }),
    );
  };
}

export function createGitHubWebhookHandler({ database, env = process.env, idFactory = randomUUID, clock = () => new Date() } = {}) {
  return async ({ request, body, rawBody } = {}) => {
    const webhookSecret = normalizeOptionalString(env.GITHUB_APP_WEBHOOK_SECRET);

    if (!webhookSecret) {
      return buildResponse(503, {
        error: 'github_webhook_not_configured',
        message: 'GITHUB_APP_WEBHOOK_SECRET is required before accepting GitHub App webhooks.',
      });
    }

    const signatureHeader = normalizeOptionalString(request?.headers?.['x-hub-signature-256']);
    const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : '';

    if (
      !verifyGitHubWebhookSignature({
        payload,
        secret: webhookSecret,
        signatureHeader,
      })
    ) {
      return buildResponse(401, {
        error: 'github_webhook_signature_invalid',
        message: 'GitHub webhook signature validation failed.',
      });
    }

    const event = normalizeOptionalString(request?.headers?.['x-github-event']) || 'unknown';
    const deliveryId = normalizeOptionalString(request?.headers?.['x-github-delivery']) || null;
    const installationId =
      normalizeOptionalIntegerString(body?.installation?.id) ??
      normalizeOptionalIntegerString(body?.installation?.account?.id);
    const action = normalizeOptionalString(body?.action).toLowerCase();
    const sync =
      event === 'pull_request'
        ? await syncGitHubPullRequestWebhook({
            action,
            body,
            database,
            deliveryId,
            event,
            idFactory,
            clock,
          })
        : {
            status: 'ignored',
            reason: 'unsupported_event',
          };

    return buildResponse(202, {
      webhook: {
        status: 'accepted',
        event,
        deliveryId,
        installationId,
        sync,
      },
    });
  };
}

export function createProjectUpdateHandler({ database } = {}) {
  return async ({ params = {}, body } = {}) => {
    const projectSlug = normalizeOptionalString(params.project);

    if (!projectSlug) {
      return buildResponse(400, {
        error: 'invalid_project_slug',
        message: 'Project slug is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getProject') || !hasReadyPersistence(database, 'upsertProject')) {
      return notWiredResponse('Project persistence is not wired yet.');
    }

    const validation = validateProjectPayload(body, projectSlug);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_project_payload',
        issues: validation.errors,
      });
    }

    const existingProject = await database.getProject(projectSlug);
    const nextProject = buildProjectRecordFromPayload(validation.value, projectSlug, existingProject);
    const updatedProject = await database.upsertProject(nextProject);

    return buildResponse(200, {
      project: serializeProjectRecord(updatedProject),
    });
  };
}

export function createContributionListHandler({ database } = {}) {
  return async () => {
    if (!hasReadyPersistence(database, 'listContributions')) {
      return notWiredResponse('Contribution persistence is not wired yet.');
    }

    const details = await database.listContributions();
    const contributions = details
      .slice()
      .sort((left, right) => String(right.contribution.createdAt).localeCompare(String(left.contribution.createdAt)))
      .map((detail) =>
        serializeContributionSummary(
          detail.contribution,
          detail.specVersions,
          detail.implementationJobs,
          detail.pullRequests,
          detail.previewDeployments,
        ),
      );

    return buildResponse(200, {
      contributions,
    });
  };
}

export function createContributionDetailHandler({ database } = {}) {
  return async ({ params = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail')) {
      return notWiredResponse('Contribution detail persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    return buildResponse(200, buildContributionSnapshot(detail));
  };
}

export function createContributionPreviewEvidenceHandler({
  database,
  previewEvidenceService = createConfiguredPreviewEvidenceService(),
} = {}) {
  return async ({ params = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail')) {
      return notWiredResponse('Contribution detail persistence is not wired yet.');
    }

    if (!previewEvidenceService || typeof previewEvidenceService.getPreviewEvidence !== 'function') {
      return notWiredResponse('Preview evidence service is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    const latestPullRequest = getLatestByCreatedAt(asArray(detail.pullRequests));

    if (!latestPullRequest) {
      return buildResponse(409, {
        error: 'pull_request_not_recorded',
        contributionId,
      });
    }

    try {
      const evidence = await previewEvidenceService.getPreviewEvidence({
        repositoryFullName: latestPullRequest.repositoryFullName,
        pullRequestNumber: latestPullRequest.number,
        contributionId,
      });

      return buildResponse(200, {
        contributionId,
        pullRequest: serializePullRequest(latestPullRequest),
        evidence,
      });
    } catch (error) {
      return previewEvidenceServiceErrorResponse(error);
    }
  };
}

export function createContributionHandler({
  database,
  specService = createConfiguredSpecService(),
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ body } = {}) => {
    const validation = validateContributionCreatePayload(body);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_contribution_payload',
        issues: validation.errors,
      });
    }

    if (!hasReadyPersistence(database, 'createContribution') || !hasReadyPersistence(database, 'getProject')) {
      return notWiredResponse('Contribution persistence is not wired yet.');
    }

    const project = await database.getProject(validation.value.project);

    if (!project) {
      return buildResponse(404, {
        error: 'project_not_found',
        project: validation.value.project,
      });
    }

    const hostOrigin = normalizeOriginValue(validation.value.hostOrigin);

    if (!hostOrigin) {
      return buildResponse(400, {
        error: 'invalid_host_origin',
        message: 'Contribution create requests must include a valid host origin.',
      });
    }

    if (!projectAllowsOrigin(project, hostOrigin)) {
      return buildResponse(403, {
        error: 'origin_not_allowed',
        project: validation.value.project,
        hostOrigin,
      });
    }

    const createdAt = clock().toISOString();
    const contributionId = idFactory();
    const attachments = validation.value.attachments.map((attachment) =>
      createAttachmentRecord(attachment, contributionId, createdAt, idFactory),
    );
    const contribution = {
      id: contributionId,
      projectSlug: project.slug,
      environment: validation.value.environment,
      type: validation.value.type,
      title: validation.value.title,
      body: validation.value.body ?? null,
      state: INITIAL_CONTRIBUTION_STATE,
      payload: {
        ...validation.value,
        hostOrigin,
      },
      createdAt,
      updatedAt: createdAt,
    };
    const requesterMessage = createUserMessage({
      id: idFactory(),
      contributionId,
      body: validation.value.body ?? validation.value.title,
      createdAt,
    });

    let openingTurn;
    try {
      openingTurn = await specService.startConversation({
        contribution,
        attachments,
        fallbackAcceptanceCriteria: buildAcceptanceCriteria({
          contribution,
          attachments,
          revisionNote: null,
        }),
        fallbackNonGoals: buildNonGoals(contribution),
        messages: [requesterMessage],
      });
    } catch (error) {
      return specServiceErrorResponse(error);
    }

    const createdEvent = {
      id: idFactory(),
      contributionId,
      kind: CREATED_CONTRIBUTION_PROGRESS_EVENT_KIND,
      status: INITIAL_CONTRIBUTION_STATE,
      message: 'Contribution created.',
      externalUrl: null,
      payload: {
        contributionId,
        projectSlug: validation.value.project,
        environment: validation.value.environment,
        type: validation.value.type,
      },
      createdAt,
    };
    const messages = [requesterMessage];
    const specVersions = [];
    const progressEvents = [createdEvent];

    if (openingTurn.action === 'draft_spec') {
      contribution.state = SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE;
      const specVersion = buildSpecVersionRecord({
        id: idFactory(),
        contribution,
        versionNumber: 1,
        attachments,
        createdAt,
        generatedSpec: openingTurn,
      });
      const agentMessage = createAgentMessage({
        id: idFactory(),
        contributionId,
        body: openingTurn.assistantMessage,
        createdAt,
        metadata: {
          specVersionId: specVersion.id,
          versionNumber: specVersion.versionNumber,
          ...openingTurn.metadata,
        },
      });
      const specEvent = {
        id: idFactory(),
        contributionId,
        kind: GENERATED_SPEC_PROGRESS_EVENT_KIND,
        status: SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE,
        message: 'Spec v1 ready for approval.',
        externalUrl: null,
        payload: {
          contributionId,
          specVersionId: specVersion.id,
          versionNumber: specVersion.versionNumber,
        },
        createdAt,
      };
      messages.push(agentMessage);
      specVersions.push(specVersion);
      progressEvents.push(specEvent);
    } else {
      const agentMessage = createAgentMessage({
        id: idFactory(),
        contributionId,
        body: openingTurn.assistantMessage,
        createdAt,
        messageType: 'ask_user_questions',
        choices: openingTurn.questions,
        metadata: {
          questionCount: Array.isArray(openingTurn.questions) ? openingTurn.questions.length : 0,
          ...openingTurn.metadata,
        },
      });
      const clarificationEvent = {
        id: idFactory(),
        contributionId,
        kind: CLARIFICATION_REQUESTED_PROGRESS_EVENT_KIND,
        status: INITIAL_CONTRIBUTION_STATE,
        message: 'Clarification questions sent.',
        externalUrl: null,
        payload: {
          contributionId,
          questionCount: Array.isArray(openingTurn.questions) ? openingTurn.questions.length : 0,
        },
        createdAt,
      };
      messages.push(agentMessage);
      progressEvents.push(clarificationEvent);
    }

    const persisted = await database.createContribution({
      contribution,
      attachments,
      messages,
      specVersions,
      progressEvents,
    });

    return buildResponse(201, buildContributionSnapshot(persisted));
  };
}

export function createContributionMessageHandler({
  database,
  specService = createConfiguredSpecService(),
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    const validation = validateContributionMessagePayload(body);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_contribution_message_payload',
        issues: validation.errors,
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Contribution conversation persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (detail.contribution.state !== INITIAL_CONTRIBUTION_STATE) {
      return buildResponse(409, {
        error: 'contribution_not_accepting_messages',
        contributionId,
        state: detail.contribution.state,
      });
    }

    const createdAt = clock().toISOString();
    const requesterMessage = createUserMessage({
      id: idFactory(),
      contributionId,
      body: validation.value.body,
      createdAt,
      messageType: 'clarification_answer',
    });
    const nextConversation = asArray(detail.messages).concat(requesterMessage);
    const clarificationAnswerCount = countClarificationAnswers(nextConversation);
    const shouldForceDraft =
      clarificationAnswerCount >= MAX_CLARIFICATION_ANSWERS &&
      typeof specService.finalizeConversation === 'function';

    let nextTurn;
    try {
      nextTurn = await (shouldForceDraft
        ? specService.finalizeConversation({
            contribution: {
              ...detail.contribution,
              updatedAt: createdAt,
            },
            attachments: asArray(detail.attachments),
            fallbackAcceptanceCriteria: buildAcceptanceCriteria({
              contribution: detail.contribution,
              attachments: asArray(detail.attachments),
              revisionNote: validation.value.body,
            }),
            fallbackNonGoals: buildNonGoals(detail.contribution),
            messages: nextConversation,
          })
        : specService.continueConversation({
            contribution: {
              ...detail.contribution,
              updatedAt: createdAt,
            },
            attachments: asArray(detail.attachments),
            fallbackAcceptanceCriteria: buildAcceptanceCriteria({
              contribution: detail.contribution,
              attachments: asArray(detail.attachments),
              revisionNote: validation.value.body,
            }),
            fallbackNonGoals: buildNonGoals(detail.contribution),
            messages: nextConversation,
          }));
    } catch (error) {
      return specServiceErrorResponse(error);
    }

    if (nextTurn.action === 'draft_spec') {
      const versionNumber = (getLatestSpecVersion(detail.specVersions)?.versionNumber ?? 0) + 1;
      const specVersion = buildSpecVersionRecord({
        id: idFactory(),
        contribution: {
          ...detail.contribution,
          updatedAt: createdAt,
        },
        versionNumber,
        attachments: asArray(detail.attachments),
        createdAt,
        generatedSpec: nextTurn,
      });
      const agentMessage = createAgentMessage({
        id: idFactory(),
        contributionId,
        body: nextTurn.assistantMessage,
        createdAt,
        metadata: {
          specVersionId: specVersion.id,
          versionNumber: specVersion.versionNumber,
          ...nextTurn.metadata,
        },
      });
      const specEvent = {
        id: idFactory(),
        contributionId,
        kind: GENERATED_SPEC_PROGRESS_EVENT_KIND,
        status: SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE,
        message: `Spec v${specVersion.versionNumber} ready for approval.`,
        externalUrl: null,
        payload: {
          contributionId,
          specVersionId: specVersion.id,
          versionNumber: specVersion.versionNumber,
        },
        createdAt,
      };

      const updated = await database.applyContributionUpdate({
        contributionId,
        nextState: SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE,
        updatedAt: createdAt,
        messages: [requesterMessage, agentMessage],
        specVersions: [specVersion],
        progressEvents: [specEvent],
      });

      return buildResponse(200, buildContributionSnapshot(updated));
    }

    const agentMessage = createAgentMessage({
      id: idFactory(),
      contributionId,
      body: nextTurn.assistantMessage,
      createdAt,
      messageType: 'ask_user_questions',
      choices: nextTurn.questions,
      metadata: {
        questionCount: Array.isArray(nextTurn.questions) ? nextTurn.questions.length : 0,
        ...nextTurn.metadata,
      },
    });
    const clarificationEvent = {
      id: idFactory(),
      contributionId,
      kind: CLARIFICATION_REQUESTED_PROGRESS_EVENT_KIND,
      status: INITIAL_CONTRIBUTION_STATE,
      message: 'More clarification is needed.',
      externalUrl: null,
      payload: {
        contributionId,
        questionCount: Array.isArray(nextTurn.questions) ? nextTurn.questions.length : 0,
      },
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState: INITIAL_CONTRIBUTION_STATE,
      updatedAt: createdAt,
      messages: [requesterMessage, agentMessage],
      progressEvents: [clarificationEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createContributionAttachmentHandler({ database } = {}) {
  return async ({ params = {}, request } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    if (
      !hasReadyPersistence(database, 'getContributionDetail') ||
      !hasReadyPersistence(database, 'replaceAttachmentStorageKey')
    ) {
      return notWiredResponse('Attachment upload persistence is not wired yet.');
    }

    const attachmentIdHeader = Array.isArray(request?.headers?.['x-crowdship-attachment-id'])
      ? request.headers['x-crowdship-attachment-id'][0]
      : request?.headers?.['x-crowdship-attachment-id'] ?? '';
    const attachmentId = typeof attachmentIdHeader === 'string' ? attachmentIdHeader.trim() : '';

    if (!attachmentId) {
      return buildResponse(400, {
        error: 'invalid_attachment_id',
        message: 'Attachment id is required in the x-crowdship-attachment-id header.',
      });
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    const attachment = asArray(detail.attachments).find((entry) => entry?.id === attachmentId);

    if (!attachment) {
      return buildResponse(404, {
        error: 'attachment_not_found',
        contributionId,
        attachmentId,
      });
    }

    if (!isMetadataOnlyAttachmentStorageKey(attachment.storageKey)) {
      return buildResponse(409, {
        error: 'attachment_already_uploaded',
        contributionId,
        attachmentId,
      });
    }

    let storedAttachment;

    try {
      storedAttachment = await storeContributionAttachmentUpload(request, {
        contributionId,
        attachment,
      });
    } catch (error) {
      if (error instanceof AttachmentUploadError) {
        return buildResponse(error.statusCode, {
          error: error.code,
          message: error.message,
        });
      }

      return buildResponse(500, {
        error: 'attachment_upload_failed',
        message: error instanceof Error ? error.message : 'Attachment upload failed.',
      });
    }

    try {
      if (
        Number.isFinite(attachment.sizeBytes) &&
        Number.isFinite(storedAttachment.sizeBytes) &&
        attachment.sizeBytes !== storedAttachment.sizeBytes
      ) {
        deleteStoredAttachment(storedAttachment.storageKey);
        return buildResponse(400, {
          error: 'attachment_size_mismatch',
          message: 'Uploaded attachment bytes did not match the stored attachment metadata.',
        });
      }

      const updatedAttachment = await database.replaceAttachmentStorageKey({
        contributionId,
        attachmentId,
        storageKey: storedAttachment.storageKey,
      });

      if (!updatedAttachment) {
        deleteStoredAttachment(storedAttachment.storageKey);
        return buildResponse(409, {
          error: 'attachment_upload_conflict',
          message: 'Attachment upload could not be recorded.',
          contributionId,
          attachmentId,
        });
      }

      return buildResponse(201, {
        attachment: serializeAttachment(updatedAttachment),
      });
    } catch (error) {
      deleteStoredAttachment(storedAttachment.storageKey);
      throw error;
    }
  };
}

export function createSpecApprovalHandler({
  database,
  specService = createConfiguredSpecService(),
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    const validation = validateSpecApprovalPayload(body);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_spec_approval_payload',
        issues: validation.errors,
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Spec approval persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    const latestSpec = getLatestSpecVersion(detail.specVersions);

    if (!latestSpec) {
      return buildResponse(409, {
        error: 'spec_not_ready',
        contributionId,
      });
    }

    const createdAt = clock().toISOString();

    if (validation.value.decision === 'approve') {
      const requesterMessage = createUserMessage({
        id: idFactory(),
        contributionId,
        body: validation.value.note
          ? `Spec approved. Note: ${validation.value.note}`
          : 'Spec approved.',
        createdAt,
        messageType: 'spec_approval',
      });
      const progressEvent = {
        id: idFactory(),
        contributionId,
        kind: APPROVED_SPEC_PROGRESS_EVENT_KIND,
        status: SPEC_APPROVED_CONTRIBUTION_STATE,
        message: `Spec v${latestSpec.versionNumber} approved.`,
        externalUrl: null,
        payload: {
          contributionId,
          specVersionId: latestSpec.id,
          versionNumber: latestSpec.versionNumber,
        },
        createdAt,
      };
      const project = hasReadyPersistence(database, 'getProject')
        ? await database.getProject(detail.contribution.projectSlug)
        : null;
      const projectRuntimeConfig = resolveProjectRuntimeConfig(project);
      const shouldAutoQueueImplementation = normalizeOptionalBoolean(projectRuntimeConfig.autoQueueImplementation) === true;
      const queuedImplementation = shouldAutoQueueImplementation
        ? buildQueuedImplementationArtifacts({
            detail,
            projectRuntimeConfig,
            createdAt,
            idFactory,
            note: 'Auto queued after spec approval.',
            message: 'Implementation auto-queued after spec approval.',
          })
        : null;
      const updated = await database.applyContributionUpdate({
        contributionId,
        nextState: queuedImplementation ? queuedImplementation.nextState : SPEC_APPROVED_CONTRIBUTION_STATE,
        updatedAt: createdAt,
        messages: [requesterMessage],
        specVersions: [],
        progressEvents: queuedImplementation ? [progressEvent, queuedImplementation.progressEvent] : [progressEvent],
        implementationJobs: queuedImplementation ? [queuedImplementation.implementationJob] : [],
        approvedSpecVersionId: latestSpec.id,
        approvedAt: createdAt,
      });

      return buildResponse(200, buildContributionSnapshot(updated));
    }

    const refinementNote = validation.value.note ?? 'Please revise the spec.';
    let refinedSpec;
    try {
      refinedSpec = await specService.refineSpec({
        contribution: {
          ...detail.contribution,
          updatedAt: createdAt,
        },
        attachments: asArray(detail.attachments),
        currentSpec: latestSpec,
        refinementNote,
        fallbackAcceptanceCriteria: buildAcceptanceCriteria({
          contribution: detail.contribution,
          attachments: asArray(detail.attachments),
          revisionNote: refinementNote,
        }),
        fallbackNonGoals: buildNonGoals(detail.contribution),
        messages: asArray(detail.messages),
      });
    } catch (error) {
      return specServiceErrorResponse(error);
    }

    const nextSpecVersion = buildSpecVersionRecord({
      id: idFactory(),
      contribution: {
        ...detail.contribution,
        updatedAt: createdAt,
      },
      versionNumber: latestSpec.versionNumber + 1,
      attachments: asArray(detail.attachments),
      createdAt,
      revisionNote: refinementNote,
      generatedSpec: refinedSpec,
    });
    const requesterMessage = createUserMessage({
      id: idFactory(),
      contributionId,
      body: refinementNote,
      createdAt,
      messageType: 'spec_refinement',
    });
    const agentMessage = createAgentMessage({
      id: idFactory(),
      contributionId,
      body: refinedSpec.assistantMessage,
      createdAt,
      metadata: {
        specVersionId: nextSpecVersion.id,
        versionNumber: nextSpecVersion.versionNumber,
        revisionNote: refinementNote,
        ...refinedSpec.metadata,
      },
    });
    const progressEvent = {
      id: idFactory(),
      contributionId,
      kind: REFINED_SPEC_PROGRESS_EVENT_KIND,
      status: SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE,
      message: `Spec v${nextSpecVersion.versionNumber} ready after refinement.`,
      externalUrl: null,
      payload: {
        contributionId,
        specVersionId: nextSpecVersion.id,
        versionNumber: nextSpecVersion.versionNumber,
      },
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState: SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE,
      updatedAt: createdAt,
      messages: [requesterMessage, agentMessage],
      specVersions: [nextSpecVersion],
      progressEvents: [progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createContributionProgressHandler({ database } = {}) {
  return async ({ params = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getContributionProgress')) {
      return notWiredResponse('Contribution progress persistence is not wired yet.');
    }

    const progress = await database.getContributionProgress(contributionId);

    if (!progress) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    return buildResponse(200, {
      contributionId,
      contribution: serializeContribution(progress.contribution),
      lifecycle: {
        currentState: progress.contribution.state,
        events: asArray(progress.progressEvents).map(serializeProgressEvent),
      },
    });
  };
}

export function createContributionStreamHandler({
  database,
  progressStreamPollMs = Number.parseInt(process.env.CROWDSHIP_PROGRESS_STREAM_POLL_MS ?? '', 10) || 1500,
  keepAliveMs = 15000,
} = {}) {
  return async ({ params = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail')) {
      return notWiredResponse('Contribution detail persistence is not wired yet.');
    }

    const initialDetail = await database.getContributionDetail(contributionId);

    if (!initialDetail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    return buildEventStreamResponse({
      start({ request, response }) {
        let closed = false;
        let syncInFlight = false;
        let lastSnapshot = '';

        const closeStream = () => {
          if (closed) {
            return;
          }

          closed = true;
          clearInterval(pollTimer);
          clearInterval(keepAliveTimer);
          if (!response.writableEnded && !response.destroyed) {
            response.end();
          }
        };

        const pushDetail = (detail) => {
          if (closed || !detail || !detail.contribution) {
            return;
          }

          const payload = buildContributionProgressStreamPayload(detail);
          const serialized = JSON.stringify(payload);

          if (serialized === lastSnapshot) {
            return;
          }

          lastSnapshot = serialized;
          writeEventStreamEvent(response, {
            event: 'snapshot',
            id: payload.lifecycle.events.at(-1)?.id || payload.contributionId,
            data: serialized,
          });
        };

        const syncDetail = async () => {
          if (closed || syncInFlight) {
            return;
          }

          syncInFlight = true;

          try {
            const detail = await database.getContributionDetail(contributionId);

            if (!detail) {
              writeEventStreamEvent(response, {
                event: 'terminated',
                id: contributionId,
                data: { contributionId, message: 'Contribution is no longer available.' },
              });
              closeStream();
              return;
            }

            pushDetail(detail);
          } catch (error) {
            writeEventStreamEvent(response, {
              event: 'error',
              id: contributionId,
              data: {
                error: 'stream_sync_failed',
                message: error instanceof Error ? error.message : 'Contribution stream sync failed.',
              },
            });
          } finally {
            syncInFlight = false;
          }
        };

        const keepAliveTimer = setInterval(() => {
          if (!closed && !response.writableEnded && !response.destroyed) {
            response.write(`: keep-alive ${Date.now()}\n\n`);
          }
        }, keepAliveMs);
        const pollTimer = setInterval(() => {
          void syncDetail();
        }, progressStreamPollMs);

        request?.on('close', closeStream);
        response.on('close', closeStream);

        pushDetail(initialDetail);
      },
    });
  };
}

export function createQueueImplementationHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    const validation = validateQueueImplementationPayload(body);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_queue_payload',
        issues: validation.errors,
      });
    }

    if (
      !hasReadyPersistence(database, 'getContributionDetail') ||
      !hasReadyPersistence(database, 'applyContributionUpdate') ||
      !hasReadyPersistence(database, 'getProject')
    ) {
      return notWiredResponse('Implementation queue persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (!canQueueImplementationFromState(detail.contribution.state)) {
      return buildResponse(409, {
        error: 'contribution_not_ready_for_implementation',
        contributionId,
        state: detail.contribution.state,
      });
    }

    if (asArray(detail.implementationJobs).some((job) => job.status === 'queued' || job.status === 'running')) {
      return buildResponse(409, {
        error: 'implementation_already_queued',
        contributionId,
      });
    }

    const project = await database.getProject(detail.contribution.projectSlug);

    if (!project) {
      return buildResponse(404, {
        error: 'project_not_found',
        project: detail.contribution.projectSlug,
      });
    }

    const createdAt = clock().toISOString();
    const projectRuntimeConfig = resolveProjectRuntimeConfig(project, {
      repositoryFullName: validation.value.repositoryFullName,
    });
    const queuedImplementation = buildQueuedImplementationArtifacts({
      detail,
      projectRuntimeConfig,
      createdAt,
      idFactory,
      queueName: validation.value.queueName,
      branchName: validation.value.branchName,
      note: validation.value.note,
    });
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState: queuedImplementation.nextState,
      updatedAt: createdAt,
      implementationJobs: [queuedImplementation.implementationJob],
      progressEvents: [queuedImplementation.progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createPullRequestHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    const validation = validatePullRequestPayload(body);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_pull_request_payload',
        issues: validation.errors,
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Pull request persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (getContributionStateIndex(detail.contribution.state) < getContributionStateIndex(SPEC_APPROVED_CONTRIBUTION_STATE)) {
      return buildResponse(409, {
        error: 'contribution_not_ready_for_pull_request',
        contributionId,
        state: detail.contribution.state,
      });
    }

    const createdAt = clock().toISOString();
    const pullRequest = {
      id: idFactory(),
      contributionId,
      repositoryFullName: validation.value.repositoryFullName,
      number: validation.value.number,
      url: validation.value.url,
      branchName: validation.value.branchName,
      headSha: validation.value.headSha,
      status: validation.value.status,
      metadata: null,
      createdAt,
      updatedAt: createdAt,
    };
    const nextState = resolveContributionState(detail.contribution.state, PR_OPENED_CONTRIBUTION_STATE);
    const progressEvent = {
      id: idFactory(),
      contributionId,
      kind: RECORDED_PULL_REQUEST_PROGRESS_EVENT_KIND,
      status: nextState,
      message: `PR #${pullRequest.number} recorded.`,
      externalUrl: pullRequest.url,
      payload: {
        contributionId,
        pullRequestId: pullRequest.id,
        repositoryFullName: pullRequest.repositoryFullName,
        number: pullRequest.number,
      },
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState,
      updatedAt: createdAt,
      pullRequests: [pullRequest],
      progressEvents: [progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createPreviewDeploymentHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    const validation = validatePreviewDeploymentPayload(body);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_preview_deployment_payload',
        issues: validation.errors,
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Preview deployment persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (
      validation.value.pullRequestId &&
      !asArray(detail.pullRequests).some((pullRequest) => pullRequest.id === validation.value.pullRequestId)
    ) {
      return buildResponse(400, {
        error: 'pull_request_not_found',
        contributionId,
        pullRequestId: validation.value.pullRequestId,
      });
    }

    const createdAt = clock().toISOString();
    const previewDeployment = {
      id: idFactory(),
      contributionId,
      pullRequestId: validation.value.pullRequestId,
      url: validation.value.url,
      status: validation.value.status,
      gitSha: validation.value.gitSha,
      deployKind: validation.value.deployKind,
      deployedAt: validation.value.status === 'ready' ? createdAt : null,
      checkedAt: createdAt,
      errorSummary: validation.value.errorSummary,
      metadata: null,
      createdAt,
    };
    const candidateState =
      validation.value.status === 'ready'
        ? PREVIEW_READY_CONTRIBUTION_STATE
      : validation.value.status === 'deploying'
          ? PREVIEW_DEPLOYING_CONTRIBUTION_STATE
          : PREVIEW_FAILED_CONTRIBUTION_STATE;
    const nextState = resolveContributionState(detail.contribution.state, candidateState);
    const progressEvent = {
      id: idFactory(),
      contributionId,
      kind: RECORDED_PREVIEW_DEPLOYMENT_PROGRESS_EVENT_KIND,
      status: nextState,
      message:
        validation.value.status === 'ready'
          ? 'Preview is ready for review.'
          : validation.value.status === 'deploying'
            ? 'Preview deployment recorded.'
            : 'Preview deployment failed.',
      externalUrl: previewDeployment.url,
      payload: {
        contributionId,
        previewDeploymentId: previewDeployment.id,
        status: previewDeployment.status,
        deployKind: previewDeployment.deployKind,
      },
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState,
      updatedAt: createdAt,
      previewDeployments: [previewDeployment],
      progressEvents: [progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createOpenVotingHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Voting persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (!asArray(detail.previewDeployments).some((preview) => preview.status === 'ready')) {
      return buildResponse(409, {
        error: 'preview_not_ready',
        contributionId,
      });
    }

    if (detail.contribution.state === VOTING_OPEN_CONTRIBUTION_STATE) {
      return buildResponse(409, {
        error: 'voting_already_open',
        contributionId,
      });
    }

    if (detail.contribution.state !== READY_FOR_VOTING_CONTRIBUTION_STATE) {
      return buildResponse(409, {
        error: 'requester_preview_approval_required',
        contributionId,
        state: detail.contribution.state,
      });
    }

    const createdAt = clock().toISOString();
    const nextState = advanceContributionState(detail.contribution.state, VOTING_OPEN_CONTRIBUTION_STATE);
    const progressEvent = {
      id: idFactory(),
      contributionId,
      kind: OPENED_VOTING_PROGRESS_EVENT_KIND,
      status: nextState,
      message: 'Voting opened.',
      externalUrl: null,
      payload: {
        contributionId,
      },
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState,
      updatedAt: createdAt,
      progressEvents: [progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createRequestClarificationHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Clarification persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (!OWNER_CLARIFICATION_REQUESTABLE_STATES.has(detail.contribution.state)) {
      return buildResponse(409, {
        error: 'clarification_request_not_allowed',
        contributionId,
        state: detail.contribution.state,
      });
    }

    const note = readOptionalLifecycleNote(body);

    if (!note) {
      return buildResponse(400, {
        error: 'clarification_note_required',
        contributionId,
        message: 'A clarification note is required.',
      });
    }

    const createdAt = clock().toISOString();
    const agentMessage = createAgentMessage({
      id: idFactory(),
      contributionId,
      body: 'The review needs one more clarification before delivery continues.',
      createdAt,
      messageType: 'ask_user_questions',
      choices: [
        {
          id: 'owner-clarification',
          question: note,
          why: 'Answering this will unblock the next review step.',
          suggestedAnswerFormat: 'Short reply or bullets',
        },
      ],
      metadata: {
        requestedBy: 'admin',
        requestedAt: createdAt,
      },
    });
    const comment = {
      id: idFactory(),
      contributionId,
      authorUserId: null,
      authorRole: 'admin',
      body: note,
      disposition: 'needs_requester_review',
      metadata: null,
      createdAt,
    };
    const progressEvent = {
      id: idFactory(),
      contributionId,
      kind: CLARIFICATION_REQUESTED_PROGRESS_EVENT_KIND,
      status: INITIAL_CONTRIBUTION_STATE,
      message: 'Owner requested clarification.',
      externalUrl: null,
      payload: {
        contributionId,
        requestedBy: 'admin',
      },
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState: INITIAL_CONTRIBUTION_STATE,
      updatedAt: createdAt,
      messages: [agentMessage],
      comments: [comment],
      progressEvents: [progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createFlagCoreReviewHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Core review persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (!['ready_for_voting', VOTING_OPEN_CONTRIBUTION_STATE, 'core_team_flagged'].includes(detail.contribution.state)) {
      return buildResponse(409, {
        error: 'core_review_flag_not_allowed',
        contributionId,
        state: detail.contribution.state,
      });
    }

    const createdAt = clock().toISOString();
    const note = readOptionalLifecycleNote(body);
    const nextState = advanceContributionState(detail.contribution.state, 'core_team_flagged');
    const progressEvent = {
      id: idFactory(),
      contributionId,
      kind: FLAGGED_CORE_REVIEW_PROGRESS_EVENT_KIND,
      status: nextState,
      message: note ? `Flagged for core review. Note: ${note}` : 'Flagged for core review.',
      externalUrl: null,
      payload: {
        contributionId,
      },
      createdAt,
    };
    const comments = note
      ? [
          {
            id: idFactory(),
            contributionId,
            authorUserId: null,
            authorRole: 'admin',
            body: note,
            disposition: 'action_required',
            metadata: null,
            createdAt,
          },
        ]
      : [];
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState,
      updatedAt: createdAt,
      comments,
      progressEvents: [progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createStartCoreReviewHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Core review persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (!['core_team_flagged', VOTING_OPEN_CONTRIBUTION_STATE, 'core_review'].includes(detail.contribution.state)) {
      return buildResponse(409, {
        error: 'core_review_not_ready',
        contributionId,
        state: detail.contribution.state,
      });
    }

    const createdAt = clock().toISOString();
    const note = readOptionalLifecycleNote(body);
    const nextState = advanceContributionState(detail.contribution.state, 'core_review');
    const progressEvent = {
      id: idFactory(),
      contributionId,
      kind: STARTED_CORE_REVIEW_PROGRESS_EVENT_KIND,
      status: nextState,
      message: note ? `Core review started. Note: ${note}` : 'Core review started.',
      externalUrl: null,
      payload: {
        contributionId,
      },
      createdAt,
    };
    const comments = note
      ? [
          {
            id: idFactory(),
            contributionId,
            authorUserId: null,
            authorRole: 'core_team',
            body: note,
            disposition: 'note',
            metadata: null,
            createdAt,
          },
        ]
      : [];
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState,
      updatedAt: createdAt,
      comments,
      progressEvents: [progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createPreviewReviewHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    const validation = validatePreviewReviewPayload(body);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_preview_review_payload',
        issues: validation.errors,
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Preview review persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (!asArray(detail.previewDeployments).some((preview) => preview.status === 'ready')) {
      return buildResponse(409, {
        error: 'preview_not_ready',
        contributionId,
      });
    }

    if (
      ![
        PREVIEW_READY_CONTRIBUTION_STATE,
        'requester_review',
        REVISION_REQUESTED_CONTRIBUTION_STATE,
      ].includes(detail.contribution.state)
    ) {
      return buildResponse(409, {
        error: 'preview_review_not_open',
        contributionId,
        state: detail.contribution.state,
      });
    }

    const createdAt = clock().toISOString();

    if (validation.value.decision === 'approve') {
      const requesterMessage = createUserMessage({
        id: idFactory(),
        contributionId,
        body: validation.value.note ? `Preview approved. Note: ${validation.value.note}` : 'Preview approved.',
        createdAt,
        messageType: 'preview_approval',
      });
      const progressEvent = {
        id: idFactory(),
        contributionId,
        kind: APPROVED_PREVIEW_PROGRESS_EVENT_KIND,
        status: READY_FOR_VOTING_CONTRIBUTION_STATE,
        message: 'Requester approved the preview.',
        externalUrl: null,
        payload: {
          contributionId,
        },
        createdAt,
      };
      const project = hasReadyPersistence(database, 'getProject')
        ? await database.getProject(detail.contribution.projectSlug)
        : null;
      const projectRuntimeConfig = resolveProjectRuntimeConfig(project);
      const shouldAutoOpenVoting = normalizeOptionalBoolean(projectRuntimeConfig.autoOpenVoting) === true;
      const autoVotingEvent = shouldAutoOpenVoting
        ? {
            id: idFactory(),
            contributionId,
            kind: OPENED_VOTING_PROGRESS_EVENT_KIND,
            status: VOTING_OPEN_CONTRIBUTION_STATE,
            message: 'Voting auto-opened after preview approval.',
            externalUrl: null,
            payload: {
              contributionId,
            },
            createdAt,
          }
        : null;
      const previewNote = validation.value.note
        ? [
            {
              id: idFactory(),
              contributionId,
              authorUserId: null,
              authorRole: 'requester',
              body: validation.value.note,
              disposition: 'note',
              metadata: null,
              createdAt,
            },
          ]
        : [];
      const updated = await database.applyContributionUpdate({
        contributionId,
        nextState: shouldAutoOpenVoting ? VOTING_OPEN_CONTRIBUTION_STATE : READY_FOR_VOTING_CONTRIBUTION_STATE,
        updatedAt: createdAt,
        messages: [requesterMessage],
        comments: previewNote,
        progressEvents: autoVotingEvent ? [progressEvent, autoVotingEvent] : [progressEvent],
      });

      return buildResponse(200, buildContributionSnapshot(updated));
    }

    const revisionNote = validation.value.note ?? 'Please revise the preview.';
    const requesterMessage = createUserMessage({
      id: idFactory(),
      contributionId,
      body: revisionNote,
      createdAt,
      messageType: 'preview_change_request',
    });
    const comment = {
      id: idFactory(),
      contributionId,
      authorUserId: null,
      authorRole: 'requester',
      body: revisionNote,
      disposition: 'action_required',
      metadata: null,
      createdAt,
    };
    const progressEvent = {
      id: idFactory(),
      contributionId,
      kind: REQUESTED_PREVIEW_CHANGES_PROGRESS_EVENT_KIND,
      status: REVISION_REQUESTED_CONTRIBUTION_STATE,
      message: 'Requester requested changes to the preview.',
      externalUrl: null,
      payload: {
        contributionId,
      },
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState: REVISION_REQUESTED_CONTRIBUTION_STATE,
      updatedAt: createdAt,
      messages: [requesterMessage],
      comments: [comment],
      progressEvents: [progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createVoteHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    const validation = validateVotePayload(body);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_vote_payload',
        issues: validation.errors,
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Vote persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (detail.contribution.state !== VOTING_OPEN_CONTRIBUTION_STATE) {
      return buildResponse(409, {
        error: 'voting_not_open',
        contributionId,
        state: detail.contribution.state,
      });
    }

    const createdAt = clock().toISOString();
    const vote = {
      id: idFactory(),
      contributionId,
      voterUserId: validation.value.voterUserId,
      voterEmail: validation.value.voterEmail,
      voteType: validation.value.voteType,
      metadata: null,
      createdAt,
    };
    const project = hasReadyPersistence(database, 'getProject')
      ? await database.getProject(detail.contribution.projectSlug)
      : null;
    const projectRuntimeConfig = resolveProjectRuntimeConfig(project);
    const coreReviewVoteThreshold = normalizeOptionalPositiveInteger(projectRuntimeConfig.coreReviewVoteThreshold);
    const shouldFlagCoreReview = coreReviewVoteThreshold !== null && asArray(detail.votes).length + 1 >= coreReviewVoteThreshold;
    const coreReviewEvent = shouldFlagCoreReview
      ? {
          id: idFactory(),
          contributionId,
          kind: FLAGGED_CORE_REVIEW_PROGRESS_EVENT_KIND,
          status: 'core_team_flagged',
          message: 'Vote threshold reached. Core review flagged.',
          externalUrl: null,
          payload: {
            contributionId,
            threshold: coreReviewVoteThreshold,
          },
          createdAt,
        }
      : null;
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState: shouldFlagCoreReview ? 'core_team_flagged' : detail.contribution.state,
      updatedAt: createdAt,
      votes: [vote],
      progressEvents: coreReviewEvent ? [coreReviewEvent] : [],
    });

    return buildResponse(201, buildContributionSnapshot(updated));
  };
}

export function createCommentHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    const validation = validateCommentPayload(body);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_comment_payload',
        issues: validation.errors,
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Comment persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (getContributionStateIndex(detail.contribution.state) < getContributionStateIndex(SPEC_APPROVED_CONTRIBUTION_STATE)) {
      return buildResponse(409, {
        error: 'comments_not_open',
        contributionId,
        state: detail.contribution.state,
      });
    }

    const createdAt = clock().toISOString();
    const comment = {
      id: idFactory(),
      contributionId,
      authorUserId: validation.value.authorUserId,
      authorRole: validation.value.authorRole,
      body: validation.value.body,
      disposition: validation.value.disposition,
      metadata: null,
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState: detail.contribution.state,
      updatedAt: createdAt,
      comments: [comment],
    });

    return buildResponse(201, buildContributionSnapshot(updated));
  };
}

export function createCommentDispositionHandler({
  database,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';
    const commentId = typeof params.commentId === 'string' ? params.commentId.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    if (!commentId) {
      return buildResponse(400, {
        error: 'invalid_comment_id',
        message: 'Comment id is required.',
      });
    }

    const validation = validateCommentDispositionPayload(body);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_comment_disposition_payload',
        issues: validation.errors,
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Comment disposition persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    const comment = asArray(detail.comments).find((entry) => entry.id === commentId);

    if (!comment) {
      return buildResponse(404, {
        error: 'comment_not_found',
        contributionId,
        commentId,
      });
    }

    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState: detail.contribution.state,
      updatedAt: clock().toISOString(),
      updatedComments: [
        {
          ...comment,
          disposition: validation.value.disposition,
        },
      ],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createMarkMergedHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Merge persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    const mergedPullRequest = asArray(detail.pullRequests).find((pullRequest) => pullRequest.status === 'merged');

    if (!mergedPullRequest) {
      return buildResponse(409, {
        error: 'merged_pull_request_required',
        contributionId,
      });
    }

    if (detail.contribution.state === MERGED_CONTRIBUTION_STATE) {
      return buildResponse(409, {
        error: 'contribution_already_merged',
        contributionId,
      });
    }

    const createdAt = clock().toISOString();
    const nextState = advanceContributionState(detail.contribution.state, MERGED_CONTRIBUTION_STATE);
    const progressEvent = {
      id: idFactory(),
      contributionId,
      kind: MARKED_MERGED_PROGRESS_EVENT_KIND,
      status: nextState,
      message: `Merged from PR #${mergedPullRequest.number}.`,
      externalUrl: mergedPullRequest.url,
      payload: {
        contributionId,
        pullRequestId: mergedPullRequest.id,
        repositoryFullName: mergedPullRequest.repositoryFullName,
        number: mergedPullRequest.number,
      },
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState,
      updatedAt: createdAt,
      progressEvents: [progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createStartProductionDeployHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Production deploy persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    const mergedPullRequest = getLatestByCreatedAt(asArray(detail.pullRequests).filter((pullRequest) => pullRequest.status === 'merged'));

    if (!mergedPullRequest) {
      return buildResponse(409, {
        error: 'merged_pull_request_required',
        contributionId,
      });
    }

    if (!['merged', 'production_deploying'].includes(detail.contribution.state)) {
      return buildResponse(409, {
        error: 'production_deploy_not_ready',
        contributionId,
        state: detail.contribution.state,
      });
    }

    const createdAt = clock().toISOString();
    const note = readOptionalLifecycleNote(body);
    const nextState = advanceContributionState(detail.contribution.state, 'production_deploying');
    const progressEvent = {
      id: idFactory(),
      contributionId,
      kind: STARTED_PRODUCTION_DEPLOY_PROGRESS_EVENT_KIND,
      status: nextState,
      message: note ? `Production deploy started. Note: ${note}` : 'Production deploy started.',
      externalUrl: mergedPullRequest.url,
      payload: {
        contributionId,
        pullRequestId: mergedPullRequest.id,
        repositoryFullName: mergedPullRequest.repositoryFullName,
        number: mergedPullRequest.number,
      },
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState,
      updatedAt: createdAt,
      progressEvents: [progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createCompleteContributionHandler({
  database,
  completionService = createConfiguredCompletionService(),
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Completion persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    const mergedPullRequest = getLatestByCreatedAt(asArray(detail.pullRequests).filter((pullRequest) => pullRequest.status === 'merged'));

    if (!mergedPullRequest) {
      return buildResponse(409, {
        error: 'merged_pull_request_required',
        contributionId,
      });
    }

    if (!['merged', 'production_deploying', 'completed'].includes(detail.contribution.state)) {
      return buildResponse(409, {
        error: 'completion_not_ready',
        contributionId,
        state: detail.contribution.state,
      });
    }

    const createdAt = clock().toISOString();
    const note = readOptionalLifecycleNote(body);
    const fallbackSummary = buildCompletionSummary(detail, mergedPullRequest, note);
    const completion = await completionService.summarizeCompletion({
      detail,
      mergedPullRequest,
      note,
      fallbackSummary,
    });
    const summary = completion?.summary || fallbackSummary;
    const nextState = advanceContributionState(detail.contribution.state, 'completed');
    const progressEvent = {
      id: idFactory(),
      contributionId,
      kind: COMPLETED_CONTRIBUTION_PROGRESS_EVENT_KIND,
      status: nextState,
      message: 'Contribution completed.',
      externalUrl: mergedPullRequest.url,
      payload: {
        contributionId,
        pullRequestId: mergedPullRequest.id,
        repositoryFullName: mergedPullRequest.repositoryFullName,
        number: mergedPullRequest.number,
        summary,
      },
      createdAt,
    };
    const completionMessage = createAgentMessage({
      id: idFactory(),
      contributionId,
      body: summary,
      createdAt,
      metadata: {
        pullRequestNumber: mergedPullRequest.number,
        repositoryFullName: mergedPullRequest.repositoryFullName,
        completionSummary: completion?.metadata ?? null,
      },
      messageType: 'completion_summary',
    });
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState,
      updatedAt: createdAt,
      messages: [completionMessage],
      progressEvents: [progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createArchiveContributionHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Archive persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (!OWNER_ARCHIVEABLE_STATES.has(detail.contribution.state)) {
      return buildResponse(409, {
        error: 'archive_not_allowed',
        contributionId,
        state: detail.contribution.state,
      });
    }

    const note = readOptionalLifecycleNote(body);
    const createdAt = clock().toISOString();
    const progressEvent = {
      id: idFactory(),
      contributionId,
      kind: REJECTED_CONTRIBUTION_PROGRESS_EVENT_KIND,
      status: 'rejected',
      message: note ? `Contribution archived. Note: ${note}` : 'Contribution archived.',
      externalUrl: null,
      payload: {
        contributionId,
        archivedBy: 'admin',
      },
      createdAt,
    };
    const comments = note
      ? [
          {
            id: idFactory(),
            contributionId,
            authorUserId: null,
            authorRole: 'admin',
            body: note,
            disposition: 'rejected',
            metadata: null,
            createdAt,
          },
        ]
      : [];
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState: 'rejected',
      updatedAt: createdAt,
      comments,
      progressEvents: [progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createRouteHandlers(options = {}) {
  return {
    getGitHubSetup: createGitHubAppSetupHandler(options),
    getGitHubCallback: createGitHubAppCallbackHandler(options),
    postGitHubWebhook: createGitHubWebhookHandler(options),
    getHealth: createHealthHandler(options),
    getDemoVideo: createDemoVideoStatusHandler(options),
    postDemoVideoUpload: createDemoVideoUploadHandler(options),
    getProject: createProjectHandler(options),
    getProjectGitHubConnection: createProjectGitHubConnectionHandler(options),
    putProject: createProjectUpdateHandler(options),
    getProjectPublicConfig: createProjectPublicConfigHandler(options),
    getContributions: createContributionListHandler(options),
    postContribution: createContributionHandler(options),
    getContribution: createContributionDetailHandler(options),
    getPreviewEvidence: createContributionPreviewEvidenceHandler(options),
    postContributionAttachment: createContributionAttachmentHandler(options),
    postContributionMessage: createContributionMessageHandler(options),
    postSpecApproval: createSpecApprovalHandler(options),
    getContributionProgress: createContributionProgressHandler(options),
    getContributionStream: createContributionStreamHandler(options),
    postQueueImplementation: createQueueImplementationHandler(options),
    postPullRequest: createPullRequestHandler(options),
    postPreviewDeployment: createPreviewDeploymentHandler(options),
    postPreviewReview: createPreviewReviewHandler(options),
    postOpenVoting: createOpenVotingHandler(options),
    postRequestClarification: createRequestClarificationHandler(options),
    postFlagCoreReview: createFlagCoreReviewHandler(options),
    postStartCoreReview: createStartCoreReviewHandler(options),
    postVote: createVoteHandler(options),
    postComment: createCommentHandler(options),
    postCommentDisposition: createCommentDispositionHandler(options),
    postMarkMerged: createMarkMergedHandler(options),
    postStartProductionDeploy: createStartProductionDeployHandler(options),
    postCompleteContribution: createCompleteContributionHandler(options),
    postArchiveContribution: createArchiveContributionHandler(options),
  };
}
