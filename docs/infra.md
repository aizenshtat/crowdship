# Infrastructure Notes

## Host

- Server IP: `46.224.21.88`
- Domain: `crowdship.aizenshtat.eu`
- Web root: `/var/www/crowdship.aizenshtat.eu/html`
- Nginx config: `/etc/nginx/sites-available/crowdship.aizenshtat.eu`
- TLS: Certbot-managed Let's Encrypt certificate

## Current Contract

The domain must serve:

- `/` as the public placeholder
- `/health` as a plain-text health check returning `ok`

No application runtime is required yet.
