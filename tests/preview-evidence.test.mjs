import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PREVIEW_EVIDENCE_MARKER,
  parsePreviewEvidenceComment,
} from '../src/server/preview-evidence.js';

test('preview evidence parser extracts live preview fields from the workflow comment', () => {
  const comment = {
    body: `${PREVIEW_EVIDENCE_MARKER}
## Crowdship Preview

- Status: ready
- Contribution ID: \`ctrb-123\`
- Branch: \`crowdship/ctrb-123-inline-replay\`
- PR: https://github.com/aizenshtat/example/pull/42
- Run: https://github.com/aizenshtat/example/actions/runs/123456789
- Build: success
- Preview URL: https://example.aizenshtat.eu/previews/ctrb-123/
- Sentry release: \`example@abc123def456\`
- Filtered Sentry issues: https://crowdship.sentry.io/issues/?query=contribution_id%3Actrb-123
- New unhandled preview errors: unavailable until runtime Sentry tagging is wired into the app
- Failed preview sessions: unavailable until Session Replay is configured
`,
    created_at: '2026-04-18T12:00:00Z',
    updated_at: '2026-04-18T12:05:00Z',
    html_url: 'https://github.com/aizenshtat/example/pull/42#issuecomment-123',
  };

  const parsed = parsePreviewEvidenceComment(comment, 'ctrb-123');

  assert.equal(parsed.status, 'ready');
  assert.equal(parsed.statusLabel, 'ready');
  assert.equal(parsed.contributionId, 'ctrb-123');
  assert.equal(parsed.branch, 'crowdship/ctrb-123-inline-replay');
  assert.equal(parsed.pullRequestUrl, 'https://github.com/aizenshtat/example/pull/42');
  assert.equal(parsed.runUrl, 'https://github.com/aizenshtat/example/actions/runs/123456789');
  assert.equal(parsed.buildStatus, 'success');
  assert.equal(parsed.previewUrl, 'https://example.aizenshtat.eu/previews/ctrb-123/');
  assert.equal(parsed.sentryRelease, 'example@abc123def456');
  assert.equal(
    parsed.sentryIssuesUrl,
    'https://crowdship.sentry.io/issues/?query=contribution_id%3Actrb-123',
  );
  assert.equal(parsed.newUnhandledPreviewErrors, null);
  assert.equal(parsed.failedPreviewSessions, null);
  assert.equal(parsed.sourceUpdatedAt, '2026-04-18T12:05:00Z');
  assert.equal(parsed.commentUrl, 'https://github.com/aizenshtat/example/pull/42#issuecomment-123');
});

test('preview evidence parser ignores comments with the wrong contribution id or missing marker', () => {
  assert.equal(
    parsePreviewEvidenceComment(
      {
        body: '- Status: ready',
      },
      'ctrb-123',
    ),
    null,
  );

  assert.equal(
    parsePreviewEvidenceComment(
      {
        body: `${PREVIEW_EVIDENCE_MARKER}
- Status: ready
- Contribution ID: \`ctrb-999\`
`,
      },
      'ctrb-123',
    ),
    null,
  );
});
