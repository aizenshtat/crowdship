# Lightweight Roadmap

## Phase 0: Bootstrap

Status: complete

- Public repositories exist.
- Domains resolve to the server.
- Nginx serves placeholders.
- TLS is configured.
- Sentry organization and projects exist.
- Lightweight product contract exists.

## Phase 1: Example External App

Goal: make `example.aizenshtat.eu` feel like a small SaaS app with obvious user needs.

Deliverables:

- One realistic product screen.
- One or two missing-feature moments.
- Placeholder widget install location.
- Safe page context object.
- Production deploy on merge to `main`.
- Preview deploys for contribution branches.

## Phase 2: Widget Shell

Goal: load a real widget from `crowdship.aizenshtat.eu`.

Deliverables:

- Floating entrypoint.
- Contribution form.
- Attachment upload.
- Clarification chat UI.
- Structured question UI.
- Spec approval UI.
- Basic client-side context capture.
- Real submission state read from the Crowdship API.

## Phase 3: Contribution Intake

Goal: persist contributions.

Deliverables:

- API endpoint.
- Schema validation.
- Rate limiting.
- Minimal owner review list.
- Sentry instrumentation.
- Attachment storage.
- Chat message persistence.
- Spec version persistence.
- Progress event stream.

## Phase 4: Structured Product Intent

Goal: make the contribution useful to engineering.

Deliverables:

- Summary generation.
- Acceptance criteria generation.
- Duplicate detection sketch.
- Owner promote/archive actions.
- User spec approval loop.
- Revision versions when the requester changes direction.

## Phase 5: Real Implementation Worker

Goal: create real code changes in the example app.

Deliverables:

- Queue approved specs.
- Clone or fetch `aizenshtat/example`.
- Create contribution branch.
- Apply a narrow code change.
- Run tests/build.
- Push branch.
- Open PR.
- Emit progress events.

## Phase 6: Preview and Review

Goal: make the feature testable before voting.

Deliverables:

- GitHub Actions preview deploy.
- Preview URL stored on the contribution.
- Requester review state.
- Revision request flow that updates the same branch/PR.
- Voting starts only after requester approval.

## Phase 7: `cc-workspace` Bridge

Goal: show how owner-approved contributions can become private builder work.

Deliverables:

- Export contribution as spec.
- Optional GitHub issue creation.
- Optional handoff to `cc-workspace`.
- Clear code-exposure boundary.
