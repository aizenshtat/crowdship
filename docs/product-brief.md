# Product Brief

## One Line

Crowdship lets real users and customers contribute product improvements from inside the products they use, without giving them access to the private codebase.

## Why This Exists

`cc-workspace` is powerful for internal teams because employees can build apps with private context, internal data, and repo access. Crowdship is the public-facing complement: it captures useful product intent from external users, turns it into structured engineering-ready work, and keeps code ownership with the product team.

The key difference is trust boundary:

- `cc-workspace`: internal builders can use internal code and data.
- `crowdship`: external contributors can describe needs, context, votes, and examples, but never see the codebase unless the owner explicitly exposes something.

## Primary Demo

An external SaaS-style app embeds the Crowdship widget. A user notices a missing workflow, opens the widget, submits a feature request with page context, and the product owner receives a structured contribution that can become a spec, issue, or agent task.

The demo must make one thing obvious: users can move product work forward without becoming repo collaborators.

The demo must be real. No simulated agent progress, fake PRs, fake preview links, or mocked deployment states. The hackathon scope can be narrow, but every visible state transition should be backed by a real persisted record, branch, pull request, CI run, or deployed preview.

## Personas

### Product User

- Uses a product daily.
- Knows what is painful or missing.
- Does not know the codebase.
- Wants to contribute without leaving the product.

### Product Owner

- Owns the codebase and roadmap.
- Wants higher quality feedback than free-form support tickets.
- Needs control over what becomes engineering work.
- Does not want to expose source code to every customer.

### AI Builder

- Turns structured user intent into requirements, acceptance criteria, and implementation plans.
- Works only with code and data the product owner has authorized.

## Table Stakes

- Embeddable widget served from `crowdship.aizenshtat.eu`.
- Host apps can identify the project and pass safe page context.
- Users can submit feature requests, bug reports, votes, comments, UX notes, screenshots, and attachments.
- Users can chat with an agent that asks structured clarification questions before engineering work starts.
- Users approve a short generated specification before any implementation job starts.
- Contributions are tied to project, route, user identity, and app metadata.
- Approved specifications can trigger a real implementation job that creates a branch, opens a pull request, and deploys a preview.
- Product owners can review, triage, configure automation, and merge promoted contributions.
- No source code, secrets, tokens, private traces, or internal data are collected by default.

## Non-Goals For The Hackathon Demo

- Full marketplace.
- Full billing.
- Full GitHub app automation.
- Direct user-to-code write access.
- Complex enterprise permissions.
- General-purpose support ticketing.

## Success Criteria

- A judge can understand the trust boundary in under 60 seconds.
- The example app feels like a realistic external product.
- The widget install path is clear.
- A contribution produces structured output useful enough for engineering.
- A contribution produces a real branch, PR, and preview URL when approved.
- Requesters can continue the chat after seeing the preview and drive branch updates.
- The story connects naturally to `cc-workspace`.

## Core Promise

Crowdship is not a feedback form. It is a user-facing contribution workflow that can take a request from vague product intent to an owner-reviewed, production-shipped feature candidate.
