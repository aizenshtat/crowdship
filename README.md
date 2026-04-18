# Crowdship

Bootstrap infrastructure and product contracts for Crowdship.

Crowdship is intended to complement `cc-workspace`: where `cc-workspace` lets employees create apps with internal context, Crowdship will let users and customers contribute useful product changes without exposing the underlying codebase.

## Current State

This repository currently contains the Crowdship bootstrap and the first live intake/spec approval slice:

- Static public placeholder at `public/`
- HTTP API runtime at `src/server/`
- Nginx host template at `infra/nginx/`
- Local deploy helper at `scripts/deploy-static.sh`
- Postgres migration runner at `scripts/run-migrations.sh`
- Durable schema history in `migrations/*.sql`
- Product brief at `docs/product-brief.md`
- Architecture at `docs/architecture.md`
- Widget contract at `docs/widget-contract.md`
- Contribution lifecycle at `docs/contribution-lifecycle.md`
- Implementation agent contract at `docs/implementation-agent.md`
- Preview CI/CD contract at `docs/preview-cicd.md`
- Product walkthrough at `docs/demo-script.md`
- Implementation plan at `docs/implementation-plan.md`
- Security model at `docs/security-model.md`
- Sentry project notes at `docs/sentry.md`
- GitHub Actions configuration at `docs/github-configuration.md`
- Agent tooling at `docs/agent-tooling.md`
- UI quality contract at `docs/ui-quality-contract.md`
- Framework-neutral quality CI, tests, linting, and pre-commit guardrails

The API now expects durable Postgres persistence when `DATABASE_URL` is configured.

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

Production bootstrap page:

```text
https://crowdship.aizenshtat.eu
```

## Local Host Deployment

On the server:

```bash
sudo ./scripts/deploy-static.sh
```

Runtime configuration lives in:

```text
/etc/crowdship/crowdship-api.env
```

At minimum, set `DATABASE_URL` there for durable persistence. Set `REQUIRE_DATABASE=1` to make the API fail fast instead of falling back to in-memory storage when the database is unavailable. During deployment the script:

1. builds the frontend into `dist/`
2. publishes `dist/` to `/var/www/crowdship.aizenshtat.eu/html`
3. loads `/etc/crowdship/crowdship-api.env` when present
4. runs `scripts/run-migrations.sh` before restarting `crowdship-api.service`

If no `DATABASE_URL` is configured, the migration step is skipped and the rest of the deploy continues.

To run migrations manually:

```bash
set -a
source /etc/crowdship/crowdship-api.env
set +a
./scripts/run-migrations.sh
```
