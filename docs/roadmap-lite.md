# Lightweight Roadmap

## Phase 0: Bootstrap

Status: complete

- Public repositories exist.
- Domains resolve to the server.
- Nginx serves placeholders.
- TLS is configured.
- Sentry organization and projects exist.
- Lightweight demo contract exists.

## Phase 1: Example External App

Goal: make `example.aizenshtat.eu` feel like a small SaaS app with obvious user needs.

Deliverables:

- One realistic product screen.
- One or two missing-feature moments.
- Placeholder widget install location.
- Safe page context object.

## Phase 2: Widget Shell

Goal: load a real widget from `crowdship.aizenshtat.eu`.

Deliverables:

- Floating entrypoint.
- Contribution form.
- Basic client-side context capture.
- Static or mocked submission state.

## Phase 3: Contribution Intake

Goal: persist contributions.

Deliverables:

- API endpoint.
- Schema validation.
- Rate limiting.
- Minimal owner review list.
- Sentry instrumentation.

## Phase 4: Structured Product Intent

Goal: make the contribution useful to engineering.

Deliverables:

- Summary generation.
- Acceptance criteria generation.
- Duplicate detection sketch.
- Owner promote/archive actions.

## Phase 5: `cc-workspace` Bridge

Goal: show how owner-approved contributions can become private builder work.

Deliverables:

- Export contribution as spec.
- Optional GitHub issue creation.
- Optional handoff to `cc-workspace`.
- Clear code-exposure boundary.
