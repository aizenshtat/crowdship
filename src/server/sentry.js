import * as Sentry from '@sentry/node';

const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|set-cookie|password|secret|token|session|credential|api[-_]?key|private[-_]?key/i;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function redactValue(value, depth = 0) {
  if (depth > 5) {
    return '[redacted]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const next = {};

  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      next[key] = '[redacted]';
      continue;
    }

    if (key === 'data' || key === 'body' || key === 'query_string') {
      next[key] = '[redacted]';
      continue;
    }

    next[key] = redactValue(entry, depth + 1);
  }

  return next;
}

function redactEvent(event) {
  const clone = redactValue(event);

  if (isPlainObject(clone.request)) {
    clone.request = {
      ...clone.request,
      headers: redactValue(clone.request.headers ?? {}),
      cookies: '[redacted]',
      data: '[redacted]',
      query_string: '[redacted]',
    };
  }

  if (isPlainObject(clone.user)) {
    clone.user = {
      id: clone.user.id,
    };
  }

  if (Array.isArray(clone.breadcrumbs)) {
    clone.breadcrumbs = clone.breadcrumbs.map((breadcrumb) => redactValue(breadcrumb));
  }

  return clone;
}

function redactBreadcrumb(breadcrumb) {
  const clone = redactValue(breadcrumb);

  if (isPlainObject(clone?.data)) {
    clone.data = redactValue(clone.data);
  }

  return clone;
}

export function initServerSentry({
  dsn = process.env.SENTRY_DSN,
  environment = process.env.NODE_ENV ?? 'development',
  release = process.env.SENTRY_RELEASE,
  enabled = Boolean(dsn),
} = {}) {
  Sentry.init({
    dsn,
    enabled,
    environment,
    release,
    sendDefaultPii: false,
    beforeSend: redactEvent,
    beforeBreadcrumb: redactBreadcrumb,
  });

  return {
    dsn,
    environment,
    release,
    enabled,
  };
}
