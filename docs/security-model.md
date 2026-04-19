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
- Allowed origins already validated and reduced to the minimum widget-safe list.
- Public Sentry DSN.
- Public contribution form schema.
- Non-sensitive route and app metadata.

## Private Data

Never collected by default from the widget:

- Owner-side runtime project config such as repository full name, repo path, default branch, preview deploy script, automation policy, and implementation profile.
- Source code.
- API tokens.
- Session cookies.
- Authorization headers.
- Internal traces.
- Database records.
- Customer PII beyond fields the host app intentionally passes.

## Project Configuration Boundary

Project configuration is split into two categories:

- Public widget config:
  project slug, widget script URL, and the allowlisted origins needed to validate browser requests.
- Owner-only runtime config:
  repository target, branch defaults, preview URL template, production URL, execution mode, automation policy, and any runner-specific paths or scripts.

The admin `Project settings` surface may edit both categories, but the widget and host app only receive the public subset. Runtime config must stay server-side and must not be embedded into the widget bootstrap or passed back to external contributors.

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

## Implementation Automation Boundary

Users can start product intent. They do not directly start arbitrary code execution.

For a project to run implementation jobs, the project owner must configure:

- Repository connection.
- Allowed target repository.
- Branch naming policy.
- Preview deployment policy.
- Whether approved specs auto-start implementation or require admin approval.
- Maximum job runtime.
- Allowed agent capabilities.

Preferred setup:

- owner-installed GitHub App or equivalent scoped repository integration for hosted Crowdship automation, or
- customer-run worker execution inside customer infrastructure.

Crowdship must not assume direct filesystem access to the customer's repository checkout or deploy host.

The implementation worker uses owner-controlled credentials. It must write only to a feature branch and open a pull request. Production deployment remains controlled by the repository's merge and CI/CD rules.

## Public Preview Boundary

Preview deployments are public enough for requesters and voters to test. They must not expose admin secrets, debug routes, CI tokens, or private source. Preview URLs should be tied to contribution IDs and PR branches.

## Audit Requirements

Persist these events:

- Contribution created.
- Attachment uploaded.
- Agent question asked.
- User answer received.
- Spec generated.
- Spec approved.
- Implementation job queued.
- Branch created.
- PR opened.
- CI run started and finished.
- Preview deployed.
- Requester approved or requested changes.
- Voting opened.
- Comment disposition changed.
- Admin flagged, merged, rejected, or requested changes.
- Production deploy completed.
