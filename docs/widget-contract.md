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
  route: "/mission",
  appVersion: "2026.04.18",
  selectedObjectType: "anomaly",
  selectedObjectId: "signal-drop-17"
});

window.Crowdship.open({
  type: "feature_request",
  title: "Add anomaly replay for signal drops"
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
  "title": "Add anomaly replay for signal drops",
  "body": "I need to replay the selected signal drop anomaly from the mission screen.",
  "hostOrigin": "https://example.aizenshtat.eu",
  "route": "/mission",
  "url": "https://example.aizenshtat.eu/mission",
  "appVersion": "2026.04.18",
  "user": {
    "id": "customer-123",
    "email": "customer@example.com",
    "role": "customer"
  },
  "context": {
    "selectedObjectType": "anomaly",
    "selectedObjectId": "signal-drop-17"
  },
  "client": {
    "timezone": "Europe/Vienna",
    "locale": "en-US"
  },
  "attachments": [
    {
      "filename": "signal-drop-17.csv",
      "contentType": "text/csv",
      "kind": "text/csv",
      "sizeBytes": 1842
    }
  ]
}
```

`hostOrigin` is the browser-derived host origin captured by the Crowdship iframe. The server validates it against the project's allowlist before it accepts the contribution.

The widget keeps each selected `File` object in memory until contribution creation succeeds. `POST /api/v1/contributions` carries attachment metadata only. After the server returns created attachment rows, the widget uploads each binary file to `POST /api/v1/contributions/:id/attachments`.

## Contribution Detail Payload

```json
{
  "contribution": {
    "id": "ctrb_123",
    "state": "draft_chat"
  },
  "attachments": [],
  "conversation": [
    {
      "authorRole": "agent",
      "messageType": "structured_question",
      "body": "Should the replay cover the full anomaly window or only the signal drop itself?",
      "choices": [
        { "id": "drop_only", "label": "Signal drop only" },
        { "id": "full_window", "label": "Full anomaly window" }
      ],
      "createdAt": "2026-04-18T12:00:00Z"
    }
  ],
  "spec": null
}
```

When the agent has enough detail, the same contribution updates to `spec_pending_approval` and the widget switches into the spec review surface without a separate page change.

## Attachment Payload

Attachments are uploaded before or during the chat. Each attachment is stored separately and referenced from chat/spec records.

```json
{
  "contributionId": "ctrb_123",
  "kind": "screenshot",
  "filename": "mission-signal-drop-17.png",
  "contentType": "image/png",
  "sizeBytes": 381204,
  "storageKey": "projects/example/contributions/ctrb_123/mission-signal-drop-17.png"
}
```

## Attachment Upload Contract

The widget matches the created attachment rows deterministically before it uploads binary content:

- Group created rows by `filename`, `contentType`, and `sizeBytes`.
- Within each matching group, bind the nth created row to the nth selected file from the draft.
- Upload that file with the matched `attachmentId`.

This avoids duplicate filename ambiguity without asking the requester to rename files.

```text
POST /api/v1/contributions/ctrb_123/attachments
Content-Type: text/csv
X-Crowdship-Attachment-Id: attachment_123

(binary signal-drop-17.csv)
```

```json
{
  "attachment": {
    "id": "attachment_123",
    "contributionId": "ctrb_123",
    "kind": "text/csv",
    "filename": "signal-drop-17.csv",
    "contentType": "text/csv",
    "sizeBytes": 1842,
    "storageKey": "ctrb_123/attachment_123/1713451200000-8b7e7f7a-2a6c-4db4-9db1-b9478862a4c1.csv"
  }
}
```

If an attachment upload fails after contribution creation, the widget keeps the requester inside the created contribution flow and shows a clear attachment-specific error.

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
  "question": "Should the replay cover the full anomaly window or only the signal drop itself?",
  "choices": [
    {
      "id": "drop_only",
      "label": "Signal drop only"
    },
    {
      "id": "full_window",
      "label": "Full anomaly window"
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
  "title": "Add anomaly replay for signal drops",
  "goal": "Let users replay the selected signal drop anomaly from the mission screen.",
  "userProblem": "Ops users need to review a signal drop without losing mission context.",
  "acceptanceCriteria": [
    "Mission screen has a replay action for the selected anomaly.",
    "Replay stays scoped to the current mission context.",
    "Replay includes the anomaly trail and selected object details.",
    "Empty state explains how to open the selected signal drop.",
    "Replay failures show a recoverable error."
  ],
  "nonGoals": [
    "Live telemetry reconstruction.",
    "New permission tiers.",
    "Persistent replay storage."
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
GET  /api/v1/contributions/:id
POST /api/v1/contributions/:id/messages
POST /api/v1/contributions/:id/votes
POST /api/v1/contributions/:id/comments
POST /api/v1/contributions/:id/attachments
POST /api/v1/contributions/:id/spec-approval
GET  /api/v1/contributions/:id/progress
```

No endpoint should expose private source code to public widget users.
