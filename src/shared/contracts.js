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
export const LOCALHOST_DEVELOPMENT_ORIGINS = Object.freeze(LOCALHOST_ORIGINS.slice());
export const INITIAL_CONTRIBUTION_STATE = CONTRIBUTION_STATE_LIST[0];
export const CREATED_CONTRIBUTION_PROGRESS_EVENT_KIND = 'created';

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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
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
        },
      }
    : {
        ok: false,
        errors,
      };
}
