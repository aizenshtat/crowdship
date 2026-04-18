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
4. Deploy to the VPS preview directory.
5. Report preview URL.

For `main`:

1. Install dependencies.
2. Run checks.
3. Build static assets.
4. Deploy production root.

## Crowdship Tracking

Crowdship stores:

- Branch name.
- PR URL.
- GitHub run ID.
- CI conclusion.
- Preview URL.
- Deploy timestamp.
- Production deploy timestamp after merge.

## Widget Display

The widget should show:

- Current deployment status.
- Preview link when ready.
- Last updated timestamp.
- CI failure summary when available.
- Requester actions: approve preview or request changes.

## No Simulation Rule

Do not show a preview URL until the preview path responds successfully. Do not show a passing CI state unless GitHub reports it.
