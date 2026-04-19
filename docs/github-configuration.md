# GitHub Configuration

## Actions Secrets

Configured through `gh secret set`:

| Name | Purpose |
| --- | --- |
| `DEPLOY_SSH_PRIVATE_KEY` | Private key used by GitHub-hosted runners to reach the Crowdship deploy host over SSH. |
| `OPENAI_API_KEY` | OpenAI API access for AI-assisted contribution structuring. |
| `SENTRY_AUTH_TOKEN` | Sentry CLI authentication for releases and source maps. |
| `SENTRY_DSN` | Project DSN for runtime error reporting. |

## Actions Variables

Configured through `gh variable set`:

| Name | Value |
| --- | --- |
| `APP_DOMAIN` | Public admin/API domain, for example `crowdship.aizenshtat.eu`. |
| `DEPLOY_HOST` | SSH host that receives production deploys. |
| `DEPLOY_PORT` | SSH port for the deploy host, default `22`. |
| `DEPLOY_REPO_ROOT` | Remote checkout used for production deploys, for example `/root/crowdship`. |
| `DEPLOY_SSH_KNOWN_HOSTS` | Optional pinned host keys for the deploy host. |
| `DEPLOY_USER` | SSH user used for production deploys. |
| `SENTRY_ORG` | `crowdship` |
| `SENTRY_PROJECT` | `crowdship` |
| `SENTRY_URL` | `https://sentry.io/` |

## Workflow Behavior

The `Quality and Deploy` workflow always runs quality checks. On pushes to `main`, it can also create a Sentry release, deploy Crowdship to the host over SSH, and smoke-check both the admin shell and `/api/v1/health`.

If the deploy SSH contract is incomplete, the production job remains readable instead of pretending the site was published:

- the quality job still passes or fails normally
- the production job reports `configuration required`
- the run summary tells maintainers which deploy values are still missing

No secret values should be committed to the repository.
