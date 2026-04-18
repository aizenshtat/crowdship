# Crowdship

Infrastructure placeholder for the hackathon product.

Crowdship is intended to complement `cc-workspace`: where `cc-workspace` lets employees create apps with internal context, Crowdship will let users and customers contribute useful product changes without exposing the underlying codebase.

## Current State

This repository intentionally contains only bootstrap infrastructure:

- Static public placeholder at `public/`
- Nginx host template at `infra/nginx/`
- Local deploy helper at `scripts/deploy-static.sh`
- Product brief at `docs/product-brief.md`
- Architecture at `docs/architecture.md`
- Widget contract at `docs/widget-contract.md`
- Contribution lifecycle at `docs/contribution-lifecycle.md`
- Implementation agent contract at `docs/implementation-agent.md`
- Preview CI/CD contract at `docs/preview-cicd.md`
- Demo script at `docs/demo-script.md`
- Security model at `docs/security-model.md`
- Sentry project notes at `docs/sentry.md`
- GitHub Actions configuration at `docs/github-configuration.md`
- Agent tooling at `docs/agent-tooling.md`
- UI quality contract at `docs/ui-quality-contract.md`
- Framework-neutral quality CI, tests, linting, and pre-commit guardrails

Product implementation has not started yet.

## Quality Checks

```bash
npm run quality
npm test
npm run lint
```

Install local hooks:

```bash
git config core.hooksPath .githooks
```

## Public Domain

Production placeholder:

```text
https://crowdship.aizenshtat.eu
```

## Local Host Deployment

On the server:

```bash
sudo ./scripts/deploy-static.sh
```

The script publishes `public/` to `/var/www/crowdship.aizenshtat.eu/html`.
