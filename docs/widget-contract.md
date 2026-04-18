# Widget Contract

## Purpose

The Crowdship widget is the public integration surface for external products. It captures user contributions inside a host app and sends structured product intent to Crowdship.

The widget must never require the host app to expose source code.

## Future Install Snippet

```html
<script
  async
  src="https://crowdship.aizenshtat.eu/widget/v1.js"
  data-crowdship-project="example"
  data-crowdship-environment="demo"
  data-crowdship-user-id="demo-user-123"
  data-crowdship-user-email="demo@example.com"
  data-crowdship-user-role="customer"
></script>
```

## Public Configuration

These fields are safe to expose in client-side HTML:

| Field | Required | Description |
| --- | --- | --- |
| `data-crowdship-project` | Yes | Public project slug. |
| `data-crowdship-environment` | No | `demo`, `staging`, or `production`. |
| `data-crowdship-user-id` | No | Host app user identifier. |
| `data-crowdship-user-email` | No | User email, if the host app chooses to share it. |
| `data-crowdship-user-role` | No | Role such as `customer`, `admin`, `free`, or `paid`. |

The project slug is not a secret. Abuse controls must be server-side.

## Runtime API

The widget may expose a browser API:

```js
window.Crowdship.identify({
  id: "demo-user-123",
  email: "demo@example.com",
  role: "customer"
});

window.Crowdship.setContext({
  route: "/reports",
  appVersion: "2026.04.18",
  selectedObjectType: "report",
  selectedObjectId: "report-demo-7"
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
  "environment": "demo",
  "type": "feature_request",
  "title": "Export this report as CSV",
  "body": "I need to send weekly report data to finance.",
  "route": "/reports",
  "url": "https://example.aizenshtat.eu/reports",
  "appVersion": "2026.04.18",
  "user": {
    "id": "demo-user-123",
    "email": "demo@example.com",
    "role": "customer"
  },
  "context": {
    "selectedObjectType": "report",
    "selectedObjectId": "report-demo-7"
  },
  "client": {
    "timezone": "Europe/Vienna",
    "locale": "en-US"
  }
}
```

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

## Future API Shape

```text
POST /api/v1/contributions
GET  /api/v1/projects/:project/public-config
POST /api/v1/contributions/:id/votes
POST /api/v1/contributions/:id/comments
```

No endpoint should expose private source code to public widget users.
