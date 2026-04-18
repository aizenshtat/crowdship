# Infrastructure Notes

## Host

- Server IP: `46.224.21.88`
- Domain: `crowdship.aizenshtat.eu`
- Web root: `/var/www/crowdship.aizenshtat.eu/html`
- Nginx config: `/etc/nginx/sites-available/crowdship.aizenshtat.eu`
- API service unit: `/etc/systemd/system/crowdship-api.service`
- Worker service unit: `/etc/systemd/system/crowdship-worker.service`
- API runtime port: `3000`
- TLS: Certbot-managed Let's Encrypt certificate

## Current Contract

The domain must serve:

- `/` as the public placeholder
- `/health` as a plain-text health check returning `ok`
- `/api/` as a reverse proxy to the local Crowdship API on `127.0.0.1:3000`

The repo-side runtime contract is:

- systemd unit source lives at `infra/systemd/crowdship-api.service`
- worker unit source lives at `infra/systemd/crowdship-worker.service`
- the service listens on `127.0.0.1:3000`
- the unit may read `/etc/crowdship/crowdship-api.env` for runtime configuration such as `DATABASE_URL`, `OPENAI_API_KEY`, and `OPENAI_INTAKE_MODEL`
- the worker may read `/etc/crowdship/crowdship-worker.env` for `DATABASE_URL`, polling interval, target repo path, and preview deploy config
- the preview deploy helper runs from the source repository root, not the worker's temporary worktree, so preview builds see the repo's real package scripts and build output
- nginx forwards `/api/` requests to that local service
- `scripts/deploy-static.sh` may restart `crowdship-api.service` and `crowdship-worker.service` when they are already installed, and skips those steps during bootstrap

## Durable Persistence

- Postgres-backed API persistence is enabled by `DATABASE_URL` in `/etc/crowdship/crowdship-api.env`
- The intake clarification/spec flow requires `OPENAI_API_KEY` in `/etc/crowdship/crowdship-api.env`; `OPENAI_INTAKE_MODEL` defaults to `gpt-5.4` when omitted.
- `REQUIRE_DATABASE=1` can be set in the same env file to make the API refuse the in-memory fallback during runtime
- schema changes live in `migrations/*.sql` and are applied in lexical order
- `scripts/run-migrations.sh` creates and updates the `crowdship_schema_migrations` table to track applied files
- the migration runner uses local `psql` when available and can fall back to a temporary Docker Postgres client container when it is not; the fallback uses host networking by default so loopback `DATABASE_URL` values keep working on the server
- migrations are expected to stay transaction-safe because each file is applied and recorded in one transaction

## Deployment Flow

1. Update `/etc/crowdship/crowdship-api.env` with the current `DATABASE_URL` and `OPENAI_API_KEY`.
2. Run `sudo ./scripts/deploy-static.sh`.
3. The deploy script builds the frontend, syncs `dist/` to `/var/www/crowdship.aizenshtat.eu/html`, loads `/etc/crowdship/crowdship-api.env` when present, runs `scripts/run-migrations.sh` if `DATABASE_URL` is configured, and then restarts `crowdship-api.service`.
4. If no database configuration is present, migrations are skipped without failing the deploy.

For manual migration runs:

```bash
set -a
source /etc/crowdship/crowdship-api.env
set +a
./scripts/run-migrations.sh
```
