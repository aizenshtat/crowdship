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

### Mode A: Hosted Crowdship Worker

Use this when the customer is comfortable granting Crowdship scoped repository automation.

Expected setup:

- Widget snippet installed in the customer UI.
- Owner-authorized repo connection for the target repository.
- Branch and PR permissions limited to the allowed repository.
- Customer CI workflows for preview deploys, checks, and production deploys.
- Callback or pollable status for PR checks and preview URLs.

This is the simplest customer experience because no local agent installation is required inside the customer's infrastructure.

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
- Crowdship project configuration: project slug, allowed origins, preview URL pattern, production URL, base branch, and automation policy.
- Repository authorization scoped to the target repository or org.
- CI workflow templates for preview and production.
- Secrets stored in customer-controlled secret managers or GitHub Actions secrets, not on the Crowdship host.
- A documented way for Crowdship to learn PR status, CI conclusion, preview URL, and merge outcome.

## Install Steps

### 1. Install the widget

The customer adds the public script to their UI shell and passes only safe context.

### 2. Configure the project in Crowdship

Minimum project fields:

- Project slug
- Allowed origins
- Target repository
- Default branch
- Preview URL pattern
- Production URL
- Automation policy

### 3. Connect repository automation

Preferred path:

- Install the Crowdship GitHub App, or an equivalent scoped integration, on the allowed repository.

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

### 5. Choose hosted or self-hosted execution

The customer should be able to select either:

- hosted Crowdship automation with scoped repo integration, or
- self-hosted runner execution in customer infrastructure.

## Reference Deployment Note

For the hackathon reference demo, the same operator currently owns:

- `crowdship` repo and host
- `example` repo and host

That setup was acceptable for proving the product loop quickly, but it is not the long-term assumption reflected by this document.
