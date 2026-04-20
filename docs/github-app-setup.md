# GitHub App Setup

## Purpose

Crowdship hosted automation should use a GitHub App instead of a personal `gh` login when it clones repositories, pushes feature branches, and opens or updates pull requests.

The worker now supports GitHub App installation tokens derived from a repository name. That means the hosted path does not need a manually entered installation id for each project.

## Secrets

Store these on the Crowdship host and in deployment secrets:

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_CLIENT_ID`
- `GITHUB_APP_CLIENT_SECRET`
- `GITHUB_APP_WEBHOOK_SECRET`

Current use:

- `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` let the worker look up a repository installation and mint an installation access token.
- `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` are reserved for the owner-authorized connect callback.
- `GITHUB_APP_WEBHOOK_SECRET` validates signatures on `POST /api/github/webhooks`.

## Recommended Registration

Create the GitHub App under the Crowdship org account if available. Personal-account ownership is acceptable for early internal testing but is not the ideal long-term home for a production integration.

Recommended registration values:

- Homepage URL: `https://crowdship.aizenshtat.eu`
- Callback URL: `https://crowdship.aizenshtat.eu/api/github/callback`
- Setup URL: `https://crowdship.aizenshtat.eu/api/github/setup`
- Webhook URL: `https://crowdship.aizenshtat.eu/api/github/webhooks`

## Minimum Repository Permissions

Required for the current worker slice:

- Repository metadata: `read`
- Repository contents: `write`
- Pull requests: `write`

Recommended for merge-readiness evidence and future sync:

- Commit statuses: `read`
- Checks: `read`
- Actions: `read`

## Install Scope

Install the app only on the repositories Crowdship is allowed to automate. The runtime config should continue to identify the target repository explicitly through `repositoryFullName`.

## Customer-Owned Deployment Model

For the durable product model:

1. The customer installs the Crowdship widget in their app.
2. The customer authorizes the Crowdship GitHub App on the target repository or org.
3. Crowdship stores only the repository identity and connection state, not a customer personal access token.
4. Customer CI/CD remains in the customer repository with customer-owned secrets.

## Current Gap

This document covers registration, credentials, and the minimal redirect/ingest routes.

What is wired now:

- `GET /api/v1/projects/:project/github-install` is the project-scoped install entrypoint used by the admin settings view. It redirects to the shared GitHub App install URL and carries the Crowdship project slug in GitHub's `state` parameter.
- `GET /api/github/setup` redirects the browser back into Crowdship Settings after the GitHub install flow.
- `GET /api/github/callback` redirects the browser back into Crowdship Settings after an owner authorization callback or callback error.
- `GET /api/v1/projects/:project/github-connection` now returns the saved non-secret `runtimeConfig.githubConnection` metadata together with the current live lookup result. Successful live checks refresh the saved metadata.
- `POST /api/github/webhooks` validates `X-Hub-Signature-256` when `GITHUB_APP_WEBHOOK_SECRET` is configured.
- `installation` and `installation_repositories` webhook deliveries now refresh saved `runtimeConfig.githubConnection` metadata for matching hosted projects when an install is created, permissions are reaccepted, repositories are added, or repositories are removed.
- `pull_request` webhook deliveries now reconcile the recorded PR status back into Crowdship and automatically advance a contribution to `merged` when GitHub reports the PR as merged and the contribution can be identified from the PR body or Crowdship branch name.

The full owner-authorized in-product connect flow still needs:

- install/connect UI beyond the current settings view and project-scoped install redirect
- owner-authorized callback token exchange and storage
- first-class check-run, actions, and preview/deploy callbacks instead of comment scraping
