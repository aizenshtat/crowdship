# Widget Contract

## Purpose

The Crowdship widget is the public integration surface for external products. It captures user contributions inside a host app and sends structured product intent to Crowdship.

The widget must never require the host app to expose source code.

All user-facing interactions for a contribution happen through the widget:

- Initial request text.
- Screenshot and attachment upload.
- Clarification chat.
- Structured questions and answer choices.
- Short specification approval.
- Implementation progress timeline.
- Preview testing.
- Revision requests.
- Voting.
- Comments and comment disposition.
- Completion notification.

## Future Install Snippet

```html
<script
  async
  src="https://crowdship.aizenshtat.eu/widget/v1.js"
  data-crowdship-project="example"
  data-crowdship-environment="production"
  data-crowdship-user-id="customer-123"
  data-crowdship-user-email="customer@example.com"
  data-crowdship-user-role="customer"
></script>
```

## Public Configuration

These fields are safe to expose in client-side HTML:

| Field | Required | Description |
| --- | --- | --- |
| `data-crowdship-project` | Yes | Public project slug. |
| `data-crowdship-environment` | No | `development`, `staging`, or `production`. |
| `data-crowdship-user-id` | No | Host app user identifier. |
| `data-crowdship-user-email` | No | User email, if the host app chooses to share it. |
| `data-crowdship-user-role` | No | Role such as `customer`, `admin`, `free`, or `paid`. |

The project slug is not a secret. Abuse controls must be server-side.

## Runtime API

The widget may expose a browser API:

```js
window.Crowdship.identify({
  id: "customer-123",
  email: "customer@example.com",
  role: "customer"
});

window.Crowdship.setContext({
  route: "/reports",
  appVersion: "2026.04.18",
  selectedObjectType: "report",
  selectedObjectId: "report-7"
});

window.Crowdship.open({
  type: "feature_request",
  title: "Export this report as CSV"
});
```

## Contribution Types

| Type | User Intent |
| --- | --- |
| `feature_request` | "I need the product to do something new." |
| `bug_report` | "Something is broken." |
| `ux_feedback` | "This flow is confusing or slow." |
| `vote` | "This request matters to me too." |
| `comment` | "I can add context to an existing request." |

## Contribution Payload

```json
{
  "project": "example",
  "environment": "production",
  "type": "feature_request",
  "title": "Export this report as CSV",
  "body": "I need to send weekly report data to finance.",
  "route": "/reports",
  "url": "https://example.aizenshtat.eu/reports",
  "appVersion": "2026.04.18",
  "user": {
    "id": "customer-123",
    "email": "customer@example.com",
    "role": "customer"
  },
  "context": {
    "selectedObjectType": "report",
    "selectedObjectId": "report-7"
  },
  "client": {
    "timezone": "Europe/Vienna",
    "locale": "en-US"
  }
}
```

## Attachment Payload

Attachments are uploaded before or during the chat. Each attachment is stored separately and referenced from chat/spec records.

```json
{
  "contributionId": "ctrb_123",
  "kind": "screenshot",
  "filename": "reports-filtered-view.png",
  "contentType": "image/png",
  "sizeBytes": 381204,
  "storageKey": "projects/example/contributions/ctrb_123/reports-filtered-view.png"
}
```

Allowed attachment types for the first production slice:

- PNG/JPEG/WebP screenshots.
- Plain text.
- PDF.
- CSV.

Executable files and archives are rejected.

## Clarification Chat Contract

The chat agent should behave like a product-focused plan mode. It asks structured questions when it needs missing details, then produces a concise specification.

```json
{
  "messageType": "structured_question",
  "question": "Should the export include all rows or only the currently filtered rows?",
  "choices": [
    {
      "id": "filtered",
      "label": "Only filtered rows"
    },
    {
      "id": "all",
      "label": "All rows"
    }
  ],
  "allowFreeform": true
}
```

The widget renders structured questions as clear choices while still allowing the user to add nuance in text.

## Specification Approval

The agent must present a short specification before any implementation job starts.

```json
{
  "title": "Export filtered reports as CSV",
  "goal": "Let users download the currently filtered report table as a CSV file.",
  "userProblem": "Users manually copy filtered report data into spreadsheets for finance workflows.",
  "acceptanceCriteria": [
    "Reports page has an Export CSV action.",
    "Export respects currently applied filters.",
    "CSV includes visible table columns.",
    "Empty result exports include headers.",
    "Export failures show a recoverable error."
  ],
  "nonGoals": [
    "Scheduled exports.",
    "XLSX support.",
    "Permission changes."
  ]
}
```

The user can approve the spec or continue chatting. Approval creates an immutable spec version. Later changes create newer spec versions.

## Host App Responsibilities

- Pass only context that is safe for Crowdship to store.
- Avoid secrets, auth tokens, customer private data, and source snippets.
- Decide whether user email is shared.
- Provide stable user and object identifiers when useful.
- Optionally restrict widget loading by route or user role.

## Crowdship Responsibilities

- Treat all widget input as untrusted.
- Rate limit by project, IP, browser session, and user identity where available.
- Validate project and origin.
- Redact obvious secrets before storage.
- Store contribution payloads separately from owner credentials and repo access.
- Promote contributions to engineering work only through owner-controlled actions.
- Show real implementation progress from server-side jobs and CI, not simulated progress.
- Show preview links only after a real deployment has completed.

## Future API Shape

```text
POST /api/v1/contributions
GET  /api/v1/projects/:project/public-config
POST /api/v1/contributions/:id/votes
POST /api/v1/contributions/:id/comments
POST /api/v1/contributions/:id/attachments
POST /api/v1/contributions/:id/spec-approval
GET  /api/v1/contributions/:id/progress
```

No endpoint should expose private source code to public widget users.
