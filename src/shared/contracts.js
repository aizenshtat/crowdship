const CONTRIBUTION_STATE_LIST = [
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
];

const CONTRIBUTION_TYPE_LIST = [
  'feature_request',
  'bug_report',
  'ux_feedback',
  'vote',
  'comment',
];

const SPEC_APPROVAL_DECISION_LIST = ['approve', 'refine'];

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
export const LOCALHOST_DEVELOPMENT_ORIGINS = Object.freeze(LOCALHOST_ORIGINS.slice());
export const INITIAL_CONTRIBUTION_STATE = CONTRIBUTION_STATE_LIST[0];
export const SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE = 'spec_pending_approval';
export const SPEC_APPROVED_CONTRIBUTION_STATE = 'spec_approved';
export const CREATED_CONTRIBUTION_PROGRESS_EVENT_KIND = 'created';
export const GENERATED_SPEC_PROGRESS_EVENT_KIND = 'spec_generated';
export const APPROVED_SPEC_PROGRESS_EVENT_KIND = 'spec_approved';
export const REFINED_SPEC_PROGRESS_EVENT_KIND = 'spec_refined';

export const PROJECT_PUBLIC_CONFIGS = Object.freeze({
  example: Object.freeze({
    project: 'example',
    widgetScriptUrl: 'https://crowdship.aizenshtat.eu/widget/v1.js',
    allowedOrigins: Object.freeze([
      'https://example.aizenshtat.eu',
      ...LOCALHOST_ORIGINS,
    ]),
    contributionStates: CONTRIBUTION_STATES,
  }),
});

export const API_ROUTE_DEFINITIONS = Object.freeze([
  Object.freeze({ method: 'GET', path: '/api/v1/health', handler: 'getHealth' }),
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
]);

export function getProjectPublicConfig(projectSlug) {
  if (typeof projectSlug !== 'string') {
    return null;
  }

  const config = PROJECT_PUBLIC_CONFIGS[projectSlug];
  if (!config) {
    return null;
  }

  return {
    project: config.project,
    widgetScriptUrl: config.widgetScriptUrl,
    allowedOrigins: [...config.allowedOrigins],
    contributionStates: [...config.contributionStates],
  };
}

export function getProjectSeedRecord(projectSlug) {
  const config = getProjectPublicConfig(projectSlug);
  if (!config) {
    return null;
  }

  return {
    slug: config.project,
    name: config.project === 'example' ? 'Orbital Ops' : config.project,
    publicConfig: config,
    allowedOrigins: config.allowedOrigins,
  };
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
  validateStringField(payload.route, 'route', errors);
  validateStringField(payload.url, 'url', errors);
  validateStringField(payload.appVersion, 'appVersion', errors);
  validateOptionalObject(payload.user, 'user', errors);
  validateOptionalObject(payload.context, 'context', errors);
  validateOptionalObject(payload.client, 'client', errors);
  validateAttachmentMetadataList(payload.attachments, 'attachments', errors);

  if (isNonEmptyString(payload.project) && !PROJECT_PUBLIC_CONFIGS[payload.project]) {
    errors.push(`unknown project: ${payload.project}`);
  }

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
