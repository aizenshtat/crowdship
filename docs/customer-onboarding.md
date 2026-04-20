# Customer Onboarding

## Goal

Crowdship should be installable into a customer-owned product without requiring direct shell access to the customer's app server, repository checkout, or production host.

The durable target is not the current hackathon topology where one operator owns both `crowdship` and `example`. That reference deployment is useful for proving the loop, but real customers should keep ownership of their UI, repository, CI/CD, and deploy secrets.

## Default Operating Model

Preferred model:

1. Customer installs the Crowdship widget snippet in their UI.
2. Customer creates a project in Crowdship and allowlists their app origin.
3. Customer authorizes repo automation through a scoped integration such as a GitHub App installation.
4. Customer keeps preview and production deploys in their own CI/CD.
5. Crowdship opens feature branches and PRs, while customer CI reports preview and check status back to Crowdship or exposes them for polling.

In this model:

- Crowdship owns contribution data, clarification, specs, review state, and automation orchestration.
- The customer owns the source code, repository permissions, CI rules, preview environment, production deploy rules, and secrets.
- External contributors never receive repository access.

## Execution Modes

### Mode A: Hosted Remote Clone

Use this when the customer is comfortable granting Crowdship scoped repository automation.

Expected setup:

- Widget snippet installed in the customer UI.
- Owner-authorized repo connection for the target repository.
- Branch and PR permissions limited to the allowed repository.
- Customer CI workflows for preview deploys, checks, and production deploys.
- Callback or pollable status for PR checks and preview URLs.

Project settings contract:

- `executionMode=hosted_remote_clone`
- `repositoryFullName` and `defaultBranch` identify the target repository
- `repoPath` and `previewDeployScript` stay blank unless a reference host is intentionally doing local repo work

This is the simplest customer experience because no local agent installation or local repository checkout is required inside the customer's infrastructure.

### Mode B: Self-Hosted Runner

Use this when the customer does not want hosted automation writing to their repository directly.

Expected setup:

- Widget snippet installed in the customer UI.
- Crowdship still hosts intake, review, and state management.
- A customer-run worker or runner is installed inside their infrastructure.
- That runner receives only approved implementation jobs for explicitly allowed repositories.
- The runner uses customer-owned credentials and network access to create branches, open PRs, and trigger customer CI/CD.

This mode increases setup complexity but preserves a stricter trust boundary for regulated or sensitive codebases.

## Minimum Customer-Owned Artifacts

Every durable customer deployment should have:

- Widget snippet in the customer app shell.
- Crowdship project configuration: project slug, allowed origins, widget script URL, target repository, default branch, preview URL pattern, production URL, execution mode, and implementation profile.
- Repository authorization scoped to the target repository or org.
- CI workflow templates for preview and production.
- Secrets stored in customer-controlled secret managers or GitHub Actions secrets, not on the Crowdship host.
- A documented way for Crowdship to learn PR status, CI conclusion, preview URL, and merge outcome.

In the current admin shell this setup lives under `Settings -> Project settings`. That surface is the operator or owner-controlled contract for one project. It is not part of the public widget payload.

Current runtime-config field split:

- Shared repo target fields: `repositoryFullName`, `defaultBranch`, `previewBaseUrl`, `previewUrlPattern`, `productionBaseUrl`, `executionMode`, `implementationProfile`
- Local-worker-only fields: `repoPath`, `previewDeployScript`

## Supported Implementation Profiles

Crowdship only writes to repositories through explicit implementation profiles. That keeps the edit surface narrow and testable instead of pretending every repo is safe to modify.

Current profiles:

- `orbital_ops_reference`: legacy default for the demo `example` repo. This keeps the current Orbital Ops path working without extra setup.
- `react_vite_app`: first reusable customer profile for React, TypeScript, and Vite apps. It limits edits to `package.json`, `src/`, `tests/`, and `public/`, and uses only the context files that exist in the checked-out repository.

Rule:

- `example` can continue using the legacy default profile.
- Non-example projects must set `runtimeConfig.implementationProfile` explicitly.

## Install Steps

### 1. Install the widget

The customer adds the public script to their UI shell and passes only safe context.

### 2. Configure the project in Crowdship

Minimum project fields:

- Project slug
- Widget script URL
- Allowed origins
- Target repository
- Default branch
- Execution mode
- Implementation profile
- Preview URL pattern
- Production URL
- Implementation profile

Recommended split:

- Public widget-safe config:
  project slug, widget script URL, allowed origins.
- Owner-only runtime config:
  target repository, default branch, execution mode, preview URL pattern, production URL, implementation profile, and any local-worker-only overrides such as `repoPath` or `previewDeployScript`.

### 3. Connect repository automation

Preferred path:

- Use the project-scoped install entrypoint from Crowdship Settings to install the Crowdship GitHub App, or an equivalent scoped integration, on the allowed repository.
- Provision credentials and registration fields as documented in `docs/github-app-setup.md`.

What Crowdship stores:

- repository identity
- non-secret GitHub App install metadata
- last saved install status
- last live verification timestamp
- webhook-driven install sync updates from GitHub App installation and repository-selection events

Crowdship should not store a customer PAT for the hosted remote-clone path.

Fallback path:

- Customer-operated runner with customer-owned repo credentials.

Direct personal access by the Crowdship operator is not the intended product model.

### 4. Install CI/CD templates

Customer CI should own:

- Pull request checks
- Preview deploy
- Production deploy
- Sentry release/source maps when enabled
- Status callback or pollable evidence for Crowdship

The reference callback contract is:

```text
POST /api/v1/contributions/<id>/ci-status
```

with a project-scoped shared token stored in customer CI secrets and the matching Crowdship project runtime config.

### 5. Choose hosted or self-hosted execution

The customer should be able to select either:

- hosted remote clone with scoped repo integration, or
- self-hosted runner execution in customer infrastructure.

## Reference Deployment Note

For the hackathon reference demo, the same operator currently owns:

- `crowdship` repo and host
- `example` repo and host

That setup was acceptable for proving the product loop quickly, but it is not the long-term assumption reflected by this document.
