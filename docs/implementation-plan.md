# Implementation Plan

This plan is the durable build path for Crowdship and the `example` reference app. It is not a one-off hackathon script. Each phase should leave behind production-quality contracts, tests, and real state that we can keep iterating on.

## Stack Decision

Use a conservative TypeScript stack:

- TypeScript for app, widget, API, and worker code.
- React for user-facing surfaces.
- Vite for the `example` reference app.
- A TypeScript web/API stack for `crowdship`.
- Postgres for durable state.
- Drizzle or Prisma for the database layer, selected when the first schema lands.
- DB-backed jobs first; Redis/BullMQ only when job concurrency needs it.
- GitHub Actions for checks, previews, releases, and production deploys.
- Sentry for runtime errors, releases, source maps, and merge-readiness evidence.

## Required References

Before starting a phase, read the linked contracts.

| Phase | Primary Docs |
| --- | --- |
| Product scope | `docs/product-brief.md`, `docs/roadmap-lite.md` |
| Customer onboarding | `docs/customer-onboarding.md`, `docs/security-model.md`, `docs/github-app-setup.md` |
| Widget behavior | `docs/widget-contract.md`, `docs/security-model.md`, `docs/ui-quality-contract.md` |
| Contribution state | `docs/contribution-lifecycle.md`, `docs/architecture.md` |
| Agent implementation | `docs/implementation-agent.md`, `docs/contribution-lifecycle.md` |
| Preview and merge evidence | `docs/preview-cicd.md`, `docs/sentry.md` |
| UX implementation | `.agents/skills/crowdship-ui-ux/SKILL.md` and referenced files |
| Repo quality | `docs/agent-tooling.md`, `.githooks/pre-commit`, `.github/workflows/smoke.yml` |

For `example`, also read:

- `../example/docs/external-app-role.md`
- `../example/docs/widget-install-contract.md`
- `../example/docs/admin-setup.md`
- `../example/docs/ui-quality-contract.md`
- `../example/.agents/skills/example-widget-integration/SKILL.md`

## Phase 1: Orbital Ops Reference App

Goal: make `example.aizenshtat.eu` a real mobile-first Orbital Ops mission-control surface with an obvious anomaly replay opportunity.

Deliverables:

- Vite/React/TypeScript app.
- Mission-control surface with real anomaly-focused demo data.
- Missing anomaly replay workflow made obvious but not faked.
- Safe page context prepared for anomaly selection and replay.
- PWA foundations: manifest, icons, service worker registration.
- Mobile-first layout at 390x844.
- Quality checks: typecheck, build, contract tests, CI.

Read first:

- `../example/docs/external-app-role.md`
- `../example/docs/ui-quality-contract.md`
- `../example/.agents/skills/example-widget-integration/references/external-app-ux.md`

## Phase 2: Crowdship App Scaffold

Goal: create the real Crowdship shell with widget, admin, API, and persistence boundaries.

Deliverables:

- TypeScript app scaffold.
- Widget script entrypoint and iframe/shell.
- Admin dashboard shell.
- API route structure.
- Initial database schema.
- Project/origin config, split between widget-safe public config and owner-only runtime config.
- Clear worker repo contract in `Project settings`: `executionMode=hosted_remote_clone` for hosted repo cloning, `executionMode=self_hosted` for customer-run workers, with `repoPath` and `previewDeployScript` reserved for local-worker overrides.
- Sentry initialization.
- PWA foundations for admin.

Read first:

- `docs/architecture.md`
- `docs/widget-contract.md`
- `docs/security-model.md`
- `docs/ui-quality-contract.md`
- `.agents/skills/crowdship-ui-ux/SKILL.md`

## Phase 3: Real Intake And Spec Approval

Goal: take a user request from the widget to a stored contribution and approved spec.

Deliverables:

- Contribution creation API.
- Attachment metadata flow.
- Chat message persistence.
- Structured clarification flow.
- Spec version generation.
- User approval/revision states.
- Admin contribution list.
- Event stream for real progress.

Read first:

- `docs/contribution-lifecycle.md`
- `docs/widget-contract.md`
- `docs/security-model.md`
- `docs/ui-quality-contract.md`

## Phase 4: Admin Review And Merge Evidence

Goal: let product owners review contribution quality, operational health, and readiness.

Deliverables:

- Mobile-capable admin review view.
- Sentry evidence panel.
- CI/preview status panel.
- Vote/comment summary placeholder backed by real state.
- Clear owner actions: queue implementation, request clarification, archive.

Read first:

- `docs/sentry.md`
- `docs/preview-cicd.md`
- `docs/contribution-lifecycle.md`

## Phase 5: Implementation Worker

Goal: turn an approved spec into a real branch, PR, preview, and evidence trail.

Deliverables:

- Job queue.
- Repository checkout.
- Branch creation.
- Narrow code/docs/tests implementation.
- Local verification.
- PR creation/update.
- Progress events.
- Preview deployment tracking.
- Sentry release linkage.

Read first:

- `docs/implementation-agent.md`
- `docs/preview-cicd.md`
- `docs/sentry.md`
- `../example/docs/preview-cicd.md`

## Phase 6: Voting, Comments, And Completion

Goal: complete the product loop after requester preview approval.

Deliverables:

- Voting state.
- Comment dispositions.
- Requester approval of refinements.
- Core-team flagging.
- Merge notification.
- AI-generated completion explanation.
- PWA notifications for actionable states.

Read first:

- `docs/contribution-lifecycle.md`
- `docs/ui-quality-contract.md`
- `docs/sentry.md`

## Parallelization Notes

Safe parallel workstreams:

- `example` app UI can proceed while `crowdship` API/schema is planned.
- Crowdship widget shell can proceed while admin dashboard shell is built if shared contracts are stable.
- Sentry/CI release wiring can proceed independently once build outputs exist.
- PWA manifest/service worker work can proceed independently from product data flows.

Do not parallelize:

- Contribution schema and lifecycle state names.
- Widget payload contract and backend validation.
- Implementation worker behavior before preview CI/CD contract is stable.
- Notification semantics before lifecycle states are durable.

## Current Deployment Note

The hackathon reference deployment may use a shared operator-owned host for both `crowdship` and `example`. That is acceptable for proving the loop quickly, but the durable product target is documented in `docs/customer-onboarding.md`: customer-owned UI, customer-owned repository, customer-owned CI/CD, and either a scoped hosted integration or a customer-run worker.

The live reference slice now includes a real admin `Project settings` surface for the `example` project. That surface is useful for the demo and for validating the config contract, but it does not change the durable ownership target above. In particular, hosted remote-clone mode should rely on repository identity plus scoped integration, while local repo path and preview script fields remain self-hosted or reference-only overrides.

## Hackathon Demo Video Note

`public/demo-video/` and related upload helpers are hackathon submission assets only. They are not part of the core Crowdship product scope unless explicitly promoted later.

## Done Criteria For Every Phase

- The relevant docs above were read and followed.
- No simulated visible progress states were introduced.
- Mobile-first behavior was checked.
- Sentry privacy boundary was preserved.
- `npm run quality`, `npm test`, and `npm run lint` pass.
- GitHub Actions passes.
