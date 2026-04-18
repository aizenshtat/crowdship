# Preview CI/CD

## Goal

Every approved implementation should produce a real preview URL before voting. Users vote on working software, not a hypothetical spec.

## Preview URL Shape

```text
https://example.aizenshtat.eu/previews/<contribution-id>/
```

Example:

```text
https://example.aizenshtat.eu/previews/ctrb-123/
```

## Required GitHub Actions Behavior

For pull request branches:

1. Install dependencies.
2. Run checks.
3. Build static assets.
4. Create or update a Sentry release for the branch commit.
5. Upload source maps when the build produces them.
6. Deploy to the VPS preview directory.
7. Smoke test the preview URL.
8. Report preview URL and Sentry evidence.

For `main`:

1. Install dependencies.
2. Run checks.
3. Build static assets.
4. Create or update a Sentry release for the production commit.
5. Upload source maps when the build produces them.
6. Deploy production root.

## Crowdship Tracking

Crowdship stores:

- Branch name.
- PR URL.
- GitHub run ID.
- CI conclusion.
- Preview URL.
- Deploy timestamp.
- Sentry release.
- Filtered Sentry issues URL.
- New unhandled preview error count.
- Failed preview session count when available.
- Production deploy timestamp after merge.

## Widget Display

The widget should show:

- Current deployment status.
- Preview link when ready.
- Last updated timestamp.
- CI failure summary when available.
- Sentry evidence for admins and core reviewers.
- Requester actions: approve preview or request changes.

Requester-facing UI should keep Sentry summarized in plain language. Admin/core review UI may link to the filtered Sentry issue view.

## Merge Evidence

Before a feature is flagged as operationally clean for core review, Crowdship should check:

- GitHub checks passed.
- Preview URL responds successfully.
- Sentry release exists for the preview commit.
- No new unhandled Sentry issues are observed for the preview contribution.
- Known existing Sentry issues are labeled as unrelated or acknowledged.

This is a merge-readiness signal, not merge authority. Core reviewers still validate code, product fit, security, and maintainability.

## No Simulation Rule

Do not show a preview URL until the preview path responds successfully. Do not show a passing CI state unless GitHub reports it. Do not show "no new Sentry errors" unless the filtered Sentry query has been checked for the preview release or contribution id.
