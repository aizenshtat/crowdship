# Sentry

## Account

- Organization: `crowdship`
- Organization URL: `https://crowdship.sentry.io`
- Data storage location: European Union
- Hackathon promo credit: `$270` applied with code `CODEXHACK`
- Local CLI config is stored outside the repository on the deployment host.
- Auth tokens must stay outside the repository.

## Project

- Project: `crowdship`
- Platform: JavaScript
- Public DSN:

```text
https://211491f0feeaa5e7f4373689bf239f5e@o4511239953121280.ingest.de.sentry.io/4511239957643344
```

## CLI Check

```bash
sentry-cli projects list
```

## Product Role

Sentry is engineering visibility, not the Crowdship feedback product. Users should make requests, approve previews, vote, and comment through Crowdship. Sentry should stay mostly invisible to contributors and provide operational evidence to admins and core reviewers.

Use Sentry for:

- Widget runtime errors.
- Admin dashboard runtime errors.
- API and worker exceptions.
- Preview branch errors in external apps.
- Release and source map tracking.
- Merge-readiness evidence for core teams.

Do not use Sentry for:

- User feedback collection.
- Feature voting.
- Product discussions.
- Storing prompts, attachments, source code, customer records, auth headers, cookies, or full API responses.

## Runtime Integration

Once implementation starts, initialize Sentry in each runtime:

- Crowdship widget frontend.
- Crowdship admin frontend.
- Crowdship API.
- Implementation worker.
- Example app frontend.

Every event should include safe tags when available:

```text
app=crowdship
environment=preview|production
contribution_id=<id>
branch=<branch>
pr_number=<number>
release=<app>@<git-sha>
lifecycle_state=<state>
```

Do not attach request text, chat content, uploaded files, generated code, repository contents, secrets, or raw API payloads.

## Release Tracking

CI should create a Sentry release for every deployable commit:

```text
crowdship@<git-sha>
example@<git-sha>
```

Preview deploys should tag events with:

```text
environment=preview
contribution_id=<id>
branch=<branch>
pr_number=<number>
preview_url=<url>
```

Production deploys should tag:

```text
environment=production
main_commit=<git-sha>
```

Frontend builds should upload source maps when the framework generates them.

## Merge-Readiness Evidence

Crowdship should summarize Sentry as one input into the core team's merge decision.

Example evidence block:

```text
Sentry:
- New unhandled preview errors: 0
- Existing known errors: 1 unrelated
- Failed preview sessions: 0
- Slow interactions: none detected
- Release: example@<git-sha>
- Last checked: <timestamp>

Merge signal:
Operationally clean. Awaiting code review and product approval.
```

This must never auto-merge a feature. It only reduces reviewer uncertainty by showing whether the preview introduced new runtime problems.

## First Implementation Scope

For the first real implementation, target:

- SDK initialization in the widget and example app.
- Sentry release creation in CI.
- Source map upload if the selected framework produces source maps.
- Tags for `contribution_id`, `branch`, `pr_number`, and `lifecycle_state`.
- Admin dashboard link to the filtered Sentry issue view.
- PR/check summary that says whether new preview errors were observed.
