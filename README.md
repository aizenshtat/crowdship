# Crowdship

Infrastructure placeholder for the hackathon product.

Crowdship is intended to complement `cc-workspace`: where `cc-workspace` lets employees create apps with internal context, Crowdship will let users and customers contribute useful product changes without exposing the underlying codebase.

## Current State

This repository intentionally contains only bootstrap infrastructure:

- Static public placeholder at `public/`
- Nginx host template at `infra/nginx/`
- Local deploy helper at `scripts/deploy-static.sh`
- Product brief at `docs/product-brief.md`
- Widget contract at `docs/widget-contract.md`
- Demo script at `docs/demo-script.md`
- Security model at `docs/security-model.md`
- Sentry project notes at `docs/sentry.md`
- Smoke CI that validates the static placeholder and deployment files

Product implementation has not started yet.

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
