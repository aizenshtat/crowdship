import * as Sentry from '@sentry/browser';

const sensitiveKeyPattern =
  /authorization|cookie|set-cookie|password|secret|token|session|credential|api[-_]?key|private[-_]?key|headers/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value)) {
      if (sensitiveKeyPattern.test(key)) {
        result[key] = '[redacted]';
      } else {
        result[key] = redact(entry);
      }
    }

    return result;
  }

  return value;
}

export function initAdminSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();

  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    beforeSend(event) {
      const redacted = redact(event);

      if (redacted && typeof redacted === 'object') {
        return redacted as typeof event;
      }

      return event;
    },
  });
}
