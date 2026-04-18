# Architecture

## System Shape

Crowdship has three product surfaces:

1. Widget for external product users.
2. Admin dashboard for product owners.
3. Worker system for agent-driven implementation.

The example app is a separate external product that embeds the widget and receives pull requests from Crowdship automation.

```text
Example App
  |
  | loads widget and passes safe context
  v
Crowdship Widget
  |
  | contribution/chat/spec/vote API
  v
Crowdship API + Database
  |
  | approved spec queues job
  v
Implementation Worker
  |
  | creates branch, commits code, opens PR
  v
Example GitHub Repo
  |
  | GitHub Actions deploys preview and production
  v
example.aizenshtat.eu
```

## Runtime Services

### Crowdship Web

- Serves the admin dashboard.
- Serves the widget script and iframe UI.
- Calls the Crowdship API.

### Crowdship API

- Validates widget origins.
- Stores contributions, attachments, chat messages, specs, votes, comments, progress events, PRs, and preview deployments.
- Queues implementation jobs after approved specs.
- Emits progress updates to the widget.

### Implementation Worker

- Consumes approved implementation jobs.
- Checks out the target repository.
- Creates a branch.
- Applies code/docs/tests.
- Runs local verification.
- Pushes the branch.
- Opens or updates the pull request.
- Records progress events.
- Creates Sentry release metadata or records the CI release result.

### Example App

- Embeds the Crowdship widget.
- Provides safe context.
- Hosts real product screens.
- Receives real PRs.
- Deploys previews for branches and production on merge.

## Data Ownership

Crowdship owns contribution data. The external app owner owns source code. The contributor owns their request and review decisions, but does not get source access.

## Integration Points

| Integration | Purpose |
| --- | --- |
| Widget script | Entry point inside external apps. |
| Contribution API | Durable intake and chat. |
| GitHub API | Branches, commits, PRs, CI status. |
| Preview deploy | Requester and voters test working changes. |
| Sentry | Runtime error visibility, release tracking, source maps, and merge-readiness evidence. |
| OpenAI API | Clarification, spec generation, implementation support. |

## Observability Flow

Sentry receives runtime errors and release data from Crowdship and the external app. Crowdship stores only safe observability metadata:

- Sentry release.
- Filtered issue URL.
- New unhandled preview error count.
- Failed preview session count when available.
- Last checked timestamp.

Crowdship uses that metadata in admin/core review screens to show whether a preview appears operationally clean. Sentry must not receive prompts, chat contents, attachments, source code, credentials, cookies, auth headers, private customer records, or raw API responses.

## Non-Simulated Requirement

Any state shown as progress must be backed by a real record or external system state. If a branch, PR, CI run, or preview URL is shown, it must exist.
