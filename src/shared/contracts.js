const CONTRIBUTION_STATE_LIST = [
  'draft_chat',
  'spec_pending_approval',
  'spec_approved',
  'agent_queued',
  'agent_running',
  'implementation_failed',
  'pr_opened',
  'preview_deploying',
  'preview_failed',
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
];

const CONTRIBUTION_TYPE_LIST = [
  'feature_request',
  'bug_report',
  'ux_feedback',
  'vote',
  'comment',
];

const SPEC_APPROVAL_DECISION_LIST = ['approve', 'refine'];
const PREVIEW_REVIEW_DECISION_LIST = ['approve', 'request_changes'];
const IMPLEMENTATION_JOB_STATUS_LIST = ['queued', 'running', 'completed', 'failed'];
const PULL_REQUEST_STATUS_LIST = ['open', 'merged', 'closed'];
const PREVIEW_DEPLOYMENT_STATUS_LIST = ['deploying', 'ready', 'failed'];
const PREVIEW_DEPLOYMENT_KIND_LIST = ['branch_preview', 'manual_preview'];
const VOTE_TYPE_LIST = ['approve', 'block'];
const COMMENT_DISPOSITION_LIST = [
  'note',
  'action_required',
  'resolved',
  'needs_requester_review',
  'incorporated',
  'rejected',
  'split_to_new_request',
  'superseded',
];

const LOCALHOST_ORIGINS = [
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://localhost:4173',
  'http://localhost:5173',
];

export const CONTRIBUTION_STATES = Object.freeze(CONTRIBUTION_STATE_LIST.slice());
export const CONTRIBUTION_TYPES = Object.freeze(CONTRIBUTION_TYPE_LIST.slice());
export const SPEC_APPROVAL_DECISIONS = Object.freeze(SPEC_APPROVAL_DECISION_LIST.slice());
export const PREVIEW_REVIEW_DECISIONS = Object.freeze(PREVIEW_REVIEW_DECISION_LIST.slice());
export const IMPLEMENTATION_JOB_STATUSES = Object.freeze(IMPLEMENTATION_JOB_STATUS_LIST.slice());
export const PULL_REQUEST_STATUSES = Object.freeze(PULL_REQUEST_STATUS_LIST.slice());
export const PREVIEW_DEPLOYMENT_STATUSES = Object.freeze(PREVIEW_DEPLOYMENT_STATUS_LIST.slice());
export const PREVIEW_DEPLOYMENT_KINDS = Object.freeze(PREVIEW_DEPLOYMENT_KIND_LIST.slice());
export const VOTE_TYPES = Object.freeze(VOTE_TYPE_LIST.slice());
export const COMMENT_DISPOSITIONS = Object.freeze(COMMENT_DISPOSITION_LIST.slice());
export const LOCALHOST_DEVELOPMENT_ORIGINS = Object.freeze(LOCALHOST_ORIGINS.slice());
export const INITIAL_CONTRIBUTION_STATE = CONTRIBUTION_STATE_LIST[0];
export const SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE = 'spec_pending_approval';
export const SPEC_APPROVED_CONTRIBUTION_STATE = 'spec_approved';
export const AGENT_QUEUED_CONTRIBUTION_STATE = 'agent_queued';
export const IMPLEMENTATION_FAILED_CONTRIBUTION_STATE = 'implementation_failed';
export const PR_OPENED_CONTRIBUTION_STATE = 'pr_opened';
export const PREVIEW_DEPLOYING_CONTRIBUTION_STATE = 'preview_deploying';
export const PREVIEW_FAILED_CONTRIBUTION_STATE = 'preview_failed';
export const PREVIEW_READY_CONTRIBUTION_STATE = 'preview_ready';
export const READY_FOR_VOTING_CONTRIBUTION_STATE = 'ready_for_voting';
export const REVISION_REQUESTED_CONTRIBUTION_STATE = 'revision_requested';
export const VOTING_OPEN_CONTRIBUTION_STATE = 'voting_open';
export const MERGED_CONTRIBUTION_STATE = 'merged';
export const CREATED_CONTRIBUTION_PROGRESS_EVENT_KIND = 'created';
export const CLARIFICATION_REQUESTED_PROGRESS_EVENT_KIND = 'clarification_requested';
export const GENERATED_SPEC_PROGRESS_EVENT_KIND = 'spec_generated';
export const APPROVED_SPEC_PROGRESS_EVENT_KIND = 'spec_approved';
export const REFINED_SPEC_PROGRESS_EVENT_KIND = 'spec_refined';
export const QUEUED_IMPLEMENTATION_PROGRESS_EVENT_KIND = 'implementation_queued';
export const RECORDED_PULL_REQUEST_PROGRESS_EVENT_KIND = 'pull_request_recorded';
export const RECORDED_PREVIEW_DEPLOYMENT_PROGRESS_EVENT_KIND = 'preview_recorded';
export const APPROVED_PREVIEW_PROGRESS_EVENT_KIND = 'preview_approved';
export const REQUESTED_PREVIEW_CHANGES_PROGRESS_EVENT_KIND = 'preview_changes_requested';
export const OPENED_VOTING_PROGRESS_EVENT_KIND = 'voting_opened';
export const MARKED_MERGED_PROGRESS_EVENT_KIND = 'merged_recorded';
export const FLAGGED_CORE_REVIEW_PROGRESS_EVENT_KIND = 'core_review_flagged';
export const STARTED_CORE_REVIEW_PROGRESS_EVENT_KIND = 'core_review_started';
export const STARTED_PRODUCTION_DEPLOY_PROGRESS_EVENT_KIND = 'production_deploying';
export const COMPLETED_CONTRIBUTION_PROGRESS_EVENT_KIND = 'completed_recorded';
export const REJECTED_CONTRIBUTION_PROGRESS_EVENT_KIND = 'rejected_recorded';

const PROJECT_SEED_RECORD_LIST = Object.freeze([
  Object.freeze({
    slug: 'example',
    name: 'Orbital Ops',
    publicConfig: Object.freeze({
      project: 'example',
      widgetScriptUrl: 'https://crowdship.aizenshtat.eu/widget/v1.js',
      allowedOrigins: Object.freeze([
        'https://example.aizenshtat.eu',
        ...LOCALHOST_ORIGINS,
      ]),
      contributionStates: CONTRIBUTION_STATES,
    }),
    allowedOrigins: Object.freeze([
      'https://example.aizenshtat.eu',
      ...LOCALHOST_ORIGINS,
    ]),
    runtimeConfig: Object.freeze({
      executionMode: 'hosted',
      automationPolicy: 'hosted_example',
      repositoryFullName: 'aizenshtat/example',
      repoPath: '/root/example',
      defaultBranch: 'main',
      previewDeployScript: '/root/example/scripts/deploy-preview.sh',
      previewBaseUrl: 'https://example.aizenshtat.eu',
      previewUrlPattern: 'https://example.aizenshtat.eu/previews/{contributionId}/',
      productionBaseUrl: 'https://example.aizenshtat.eu',
    }),
  }),
]);

export const API_ROUTE_DEFINITIONS = Object.freeze([
  Object.freeze({ method: 'GET', path: '/api/v1/health', handler: 'getHealth' }),
  Object.freeze({ method: 'GET', path: '/api/v1/demo-video', handler: 'getDemoVideo' }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/demo-video/upload',
    handler: 'postDemoVideoUpload',
    bodyMode: 'stream',
  }),
  Object.freeze({
    method: 'GET',
    path: '/api/v1/projects/:project',
    handler: 'getProject',
  }),
  Object.freeze({
    method: 'PUT',
    path: '/api/v1/projects/:project',
    handler: 'putProject',
  }),
  Object.freeze({
    method: 'GET',
    path: '/api/v1/projects/:project/github-connection',
    handler: 'getProjectGitHubConnection',
  }),
  Object.freeze({
    method: 'GET',
    path: '/api/v1/projects/:project/public-config',
    handler: 'getProjectPublicConfig',
  }),
  Object.freeze({ method: 'GET', path: '/api/v1/contributions', handler: 'getContributions' }),
  Object.freeze({ method: 'POST', path: '/api/v1/contributions', handler: 'postContribution' }),
  Object.freeze({ method: 'GET', path: '/api/v1/contributions/:id', handler: 'getContribution' }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/contributions/:id/attachments',
    handler: 'postContributionAttachment',
    bodyMode: 'stream',
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/contributions/:id/messages',
    handler: 'postContributionMessage',
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/contributions/:id/spec-approval',
    handler: 'postSpecApproval',
  }),
  Object.freeze({
    method: 'GET',
    path: '/api/v1/contributions/:id/progress',
    handler: 'getContributionProgress',
  }),
  Object.freeze({
    method: 'GET',
    path: '/api/v1/contributions/:id/stream',
    handler: 'getContributionStream',
    responseMode: 'stream',
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/contributions/:id/queue-implementation',
    handler: 'postQueueImplementation',
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/contributions/:id/pull-requests',
    handler: 'postPullRequest',
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/contributions/:id/preview-deployments',
    handler: 'postPreviewDeployment',
  }),
  Object.freeze({
    method: 'GET',
    path: '/api/v1/contributions/:id/preview-evidence',
    handler: 'getPreviewEvidence',
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/contributions/:id/preview-review',
    handler: 'postPreviewReview',
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/contributions/:id/open-voting',
    handler: 'postOpenVoting',
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/contributions/:id/request-clarification',
    handler: 'postRequestClarification',
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/contributions/:id/flag-core-review',
    handler: 'postFlagCoreReview',
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/contributions/:id/start-core-review',
    handler: 'postStartCoreReview',
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/contributions/:id/votes',
    handler: 'postVote',
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/contributions/:id/comments',
    handler: 'postComment',
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/contributions/:id/comments/:commentId/disposition',
    handler: 'postCommentDisposition',
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/contributions/:id/mark-merged',
    handler: 'postMarkMerged',
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/contributions/:id/start-production-deploy',
    handler: 'postStartProductionDeploy',
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/contributions/:id/complete',
    handler: 'postCompleteContribution',
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/v1/contributions/:id/archive',
    handler: 'postArchiveContribution',
  }),
]);

function cloneProjectSeedRecord(record) {
  return {
    slug: record.slug,
    name: record.name,
    publicConfig: {
      project: record.publicConfig.project,
      widgetScriptUrl: record.publicConfig.widgetScriptUrl,
      allowedOrigins: [...record.publicConfig.allowedOrigins],
      contributionStates: [...record.publicConfig.contributionStates],
    },
    allowedOrigins: [...record.allowedOrigins],
    runtimeConfig: structuredClone(record.runtimeConfig),
  };
}

export function listProjectSeedRecords() {
  return PROJECT_SEED_RECORD_LIST.map(cloneProjectSeedRecord);
}

export function getProjectSeedRecord(projectSlug) {
  if (typeof projectSlug !== 'string') {
    return null;
  }

  const record = PROJECT_SEED_RECORD_LIST.find((entry) => entry.slug === projectSlug);
  return record ? cloneProjectSeedRecord(record) : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateStringField(value, fieldName, errors, { required = false } = {}) {
  if (value == null) {
    if (required) {
      errors.push(`${fieldName} is required`);
    }
    return;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${fieldName} must be a non-empty string`);
  }
}

function validateOptionalObject(value, fieldName, errors) {
  if (value == null) {
    return;
  }

  if (!isPlainObject(value)) {
    errors.push(`${fieldName} must be an object when provided`);
  }
}

function validateAttachmentMetadataList(value, fieldName, errors) {
  if (value == null) {
    return;
  }

  if (!Array.isArray(value)) {
    errors.push(`${fieldName} must be an array when provided`);
    return;
  }

  value.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      errors.push(`${fieldName}[${index}] must be an object`);
      return;
    }

    validateStringField(entry.filename, `${fieldName}[${index}].filename`, errors, { required: true });
    validateStringField(entry.contentType, `${fieldName}[${index}].contentType`, errors, { required: true });
    validateStringField(entry.kind, `${fieldName}[${index}].kind`, errors, { required: true });

    if (!Number.isFinite(entry.sizeBytes) || entry.sizeBytes < 0) {
      errors.push(`${fieldName}[${index}].sizeBytes must be a non-negative number`);
    }
  });
}

export function validateContributionCreatePayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    return {
      ok: false,
      errors: ['payload must be an object'],
    };
  }

  validateStringField(payload.project, 'project', errors, { required: true });
  validateStringField(payload.environment, 'environment', errors, { required: true });
  validateStringField(payload.type, 'type', errors, { required: true });
  validateStringField(payload.title, 'title', errors, { required: true });
  validateStringField(payload.body, 'body', errors);
  validateStringField(payload.hostOrigin, 'hostOrigin', errors, { required: true });
  validateStringField(payload.route, 'route', errors);
  validateStringField(payload.url, 'url', errors);
  validateStringField(payload.appVersion, 'appVersion', errors);
  validateOptionalObject(payload.user, 'user', errors);
  validateOptionalObject(payload.context, 'context', errors);
  validateOptionalObject(payload.client, 'client', errors);
  validateAttachmentMetadataList(payload.attachments, 'attachments', errors);

  if (isNonEmptyString(payload.environment)) {
    const allowedEnvironments = new Set(['development', 'staging', 'production']);
    if (!allowedEnvironments.has(payload.environment)) {
      errors.push('environment must be one of development, staging, or production');
    }
  }

  if (isNonEmptyString(payload.type) && !CONTRIBUTION_TYPES.includes(payload.type)) {
    errors.push(`type must be one of ${CONTRIBUTION_TYPES.join(', ')}`);
  }

  return errors.length === 0
    ? {
        ok: true,
        value: {
          ...payload,
          project: payload.project.trim(),
          environment: payload.environment.trim(),
          type: payload.type.trim(),
          title: payload.title.trim(),
          body: normalizeOptionalString(payload.body) || null,
          hostOrigin: payload.hostOrigin.trim(),
          route: normalizeOptionalString(payload.route) || null,
          url: normalizeOptionalString(payload.url) || null,
          appVersion: normalizeOptionalString(payload.appVersion) || null,
          attachments: Array.isArray(payload.attachments)
            ? payload.attachments.map((attachment) => ({
                filename: attachment.filename.trim(),
                contentType: attachment.contentType.trim(),
                kind: attachment.kind.trim(),
                sizeBytes: Number(attachment.sizeBytes),
              }))
            : [],
        },
      }
    : {
        ok: false,
        errors,
      };
}

export function validateSpecApprovalPayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    return {
      ok: false,
      errors: ['payload must be an object'],
    };
  }

  validateStringField(payload.decision, 'decision', errors, { required: true });
  validateStringField(payload.note, 'note', errors);

  if (isNonEmptyString(payload.decision) && !SPEC_APPROVAL_DECISIONS.includes(payload.decision)) {
    errors.push(`decision must be one of ${SPEC_APPROVAL_DECISIONS.join(', ')}`);
  }

  if (payload.decision === 'refine' && !isNonEmptyString(payload.note)) {
    errors.push('note is required when requesting a spec refinement');
  }

  return errors.length === 0
    ? {
        ok: true,
        value: {
          decision: payload.decision.trim(),
          note: normalizeOptionalString(payload.note) || null,
        },
      }
    : {
        ok: false,
        errors,
      };
}

export function validatePreviewReviewPayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    return {
      ok: false,
      errors: ['payload must be an object'],
    };
  }

  validateStringField(payload.decision, 'decision', errors, { required: true });
  validateStringField(payload.note, 'note', errors);

  if (isNonEmptyString(payload.decision) && !PREVIEW_REVIEW_DECISIONS.includes(payload.decision)) {
    errors.push(`decision must be one of ${PREVIEW_REVIEW_DECISIONS.join(', ')}`);
  }

  if (payload.decision === 'request_changes' && !isNonEmptyString(payload.note)) {
    errors.push('note is required when requesting preview changes');
  }

  return errors.length === 0
    ? {
        ok: true,
        value: {
          decision: payload.decision.trim(),
          note: normalizeOptionalString(payload.note) || null,
        },
      }
    : {
        ok: false,
        errors,
      };
}

export function validateContributionMessagePayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    return {
      ok: false,
      errors: ['payload must be an object'],
    };
  }

  validateStringField(payload.body, 'body', errors, { required: true });

  return errors.length === 0
    ? {
        ok: true,
        value: {
          body: payload.body.trim(),
        },
      }
    : {
        ok: false,
        errors,
      };
}

export function validateQueueImplementationPayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    return {
      ok: false,
      errors: ['payload must be an object'],
    };
  }

  validateStringField(payload.queueName, 'queueName', errors);
  validateStringField(payload.branchName, 'branchName', errors);
  validateStringField(payload.repositoryFullName, 'repositoryFullName', errors);
  validateStringField(payload.note, 'note', errors);

  return errors.length === 0
    ? {
        ok: true,
        value: {
          queueName: normalizeOptionalString(payload.queueName) || 'default',
          branchName: normalizeOptionalString(payload.branchName) || null,
          repositoryFullName: normalizeOptionalString(payload.repositoryFullName) || null,
          note: normalizeOptionalString(payload.note) || null,
        },
      }
    : {
        ok: false,
        errors,
      };
}

export function validatePullRequestPayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    return {
      ok: false,
      errors: ['payload must be an object'],
    };
  }

  validateStringField(payload.repositoryFullName, 'repositoryFullName', errors, { required: true });
  validateStringField(payload.url, 'url', errors, { required: true });
  validateStringField(payload.branchName, 'branchName', errors, { required: true });
  validateStringField(payload.status, 'status', errors, { required: true });
  validateStringField(payload.headSha, 'headSha', errors);

  if (!Number.isInteger(payload.number) || payload.number <= 0) {
    errors.push('number must be a positive integer');
  }

  if (isNonEmptyString(payload.status) && !PULL_REQUEST_STATUSES.includes(payload.status)) {
    errors.push(`status must be one of ${PULL_REQUEST_STATUSES.join(', ')}`);
  }

  return errors.length === 0
    ? {
        ok: true,
        value: {
          repositoryFullName: payload.repositoryFullName.trim(),
          number: payload.number,
          url: payload.url.trim(),
          branchName: payload.branchName.trim(),
          headSha: normalizeOptionalString(payload.headSha) || null,
          status: payload.status.trim(),
        },
      }
    : {
        ok: false,
        errors,
      };
}

export function validatePreviewDeploymentPayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    return {
      ok: false,
      errors: ['payload must be an object'],
    };
  }

  validateStringField(payload.url, 'url', errors, { required: true });
  validateStringField(payload.status, 'status', errors, { required: true });
  validateStringField(payload.deployKind, 'deployKind', errors, { required: true });
  validateStringField(payload.gitSha, 'gitSha', errors);
  validateStringField(payload.pullRequestId, 'pullRequestId', errors);
  validateStringField(payload.errorSummary, 'errorSummary', errors);

  if (isNonEmptyString(payload.status) && !PREVIEW_DEPLOYMENT_STATUSES.includes(payload.status)) {
    errors.push(`status must be one of ${PREVIEW_DEPLOYMENT_STATUSES.join(', ')}`);
  }

  if (isNonEmptyString(payload.deployKind) && !PREVIEW_DEPLOYMENT_KINDS.includes(payload.deployKind)) {
    errors.push(`deployKind must be one of ${PREVIEW_DEPLOYMENT_KINDS.join(', ')}`);
  }

  return errors.length === 0
    ? {
        ok: true,
        value: {
          url: payload.url.trim(),
          status: payload.status.trim(),
          deployKind: payload.deployKind.trim(),
          gitSha: normalizeOptionalString(payload.gitSha) || null,
          pullRequestId: normalizeOptionalString(payload.pullRequestId) || null,
          errorSummary: normalizeOptionalString(payload.errorSummary) || null,
        },
      }
    : {
        ok: false,
        errors,
      };
}

export function validateVotePayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    return {
      ok: false,
      errors: ['payload must be an object'],
    };
  }

  validateStringField(payload.voteType, 'voteType', errors, { required: true });
  validateStringField(payload.voterUserId, 'voterUserId', errors);
  validateStringField(payload.voterEmail, 'voterEmail', errors);

  if (isNonEmptyString(payload.voteType) && !VOTE_TYPES.includes(payload.voteType)) {
    errors.push(`voteType must be one of ${VOTE_TYPES.join(', ')}`);
  }

  return errors.length === 0
    ? {
        ok: true,
        value: {
          voteType: payload.voteType.trim(),
          voterUserId: normalizeOptionalString(payload.voterUserId) || null,
          voterEmail: normalizeOptionalString(payload.voterEmail) || null,
        },
      }
    : {
        ok: false,
        errors,
      };
}

export function validateCommentPayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    return {
      ok: false,
      errors: ['payload must be an object'],
    };
  }

  validateStringField(payload.authorRole, 'authorRole', errors, { required: true });
  validateStringField(payload.body, 'body', errors, { required: true });
  validateStringField(payload.disposition, 'disposition', errors, { required: true });
  validateStringField(payload.authorUserId, 'authorUserId', errors);

  if (isNonEmptyString(payload.disposition) && !COMMENT_DISPOSITIONS.includes(payload.disposition)) {
    errors.push(`disposition must be one of ${COMMENT_DISPOSITIONS.join(', ')}`);
  }

  return errors.length === 0
    ? {
        ok: true,
        value: {
          authorRole: payload.authorRole.trim(),
          body: payload.body.trim(),
          disposition: payload.disposition.trim(),
          authorUserId: normalizeOptionalString(payload.authorUserId) || null,
        },
      }
    : {
        ok: false,
        errors,
      };
}

export function validateCommentDispositionPayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    return {
      ok: false,
      errors: ['payload must be an object'],
    };
  }

  validateStringField(payload.disposition, 'disposition', errors, { required: true });

  if (isNonEmptyString(payload.disposition) && !COMMENT_DISPOSITIONS.includes(payload.disposition)) {
    errors.push(`disposition must be one of ${COMMENT_DISPOSITIONS.join(', ')}`);
  }

  return errors.length === 0
    ? {
        ok: true,
        value: {
          disposition: payload.disposition.trim(),
        },
      }
    : {
        ok: false,
        errors,
      };
}
