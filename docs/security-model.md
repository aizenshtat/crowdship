# Security Model

## Trust Boundary

Crowdship has two sides:

- Public widget surface used by external product users.
- Private owner surface used by product teams and authorized AI builders.

The public side can create product intent. The private side controls whether that intent becomes code, issues, specs, or agent tasks.

## Public Data

Safe to expose in a browser:

- Project slug.
- Widget script URL.
- Public Sentry DSN.
- Public contribution form schema.
- Non-sensitive route and app metadata.

## Private Data

Never collected by default from the widget:

- Source code.
- API tokens.
- Session cookies.
- Authorization headers.
- Internal traces.
- Database records.
- Customer PII beyond fields the host app intentionally passes.

## Abuse Controls

The public widget must assume hostile clients. Required controls:

- Origin allowlist per project.
- Per-project rate limits.
- Per-IP rate limits.
- Optional user-level limits when identity is present.
- Payload size limits.
- Server-side schema validation.
- Secret redaction before persistence.
- Admin review before any promoted engineering action.

## Owner-Controlled Code Access

Future code automation should require explicit owner authorization:

1. A user submits a contribution.
2. Crowdship structures it into requirements.
3. Product owner approves or edits the request.
4. Only then can an internal builder or agent work against the private repo.

External contributors do not receive repo access as part of this flow.
