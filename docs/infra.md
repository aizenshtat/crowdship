# Infrastructure Notes

## Host

- Server IP: `46.224.21.88`
- Domain: `crowdship.aizenshtat.eu`
- Web root: `/var/www/crowdship.aizenshtat.eu/html`
- Nginx config: `/etc/nginx/sites-available/crowdship.aizenshtat.eu`
- API service unit: `/etc/systemd/system/crowdship-api.service`
- API runtime port: `3000`
- TLS: Certbot-managed Let's Encrypt certificate

## Current Contract

The domain must serve:

- `/` as the public placeholder
- `/health` as a plain-text health check returning `ok`
- `/api/` as a reverse proxy to the local Crowdship API on `127.0.0.1:3000`

The repo-side runtime contract is:

- systemd unit source lives at `infra/systemd/crowdship-api.service`
- the service listens on `127.0.0.1:3000`
- the unit may read `/etc/crowdship/crowdship-api.env` for runtime configuration such as `DATABASE_URL`
- nginx forwards `/api/` requests to that local service
- `scripts/deploy-static.sh` may restart `crowdship-api.service` when it is already installed, and skips that step during bootstrap
