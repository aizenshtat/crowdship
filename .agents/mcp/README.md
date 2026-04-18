# MCP And Tooling

This project should keep tool usage explicit so agents can reproduce the build environment.

## Used In This Project

| Tool | Purpose |
| --- | --- |
| GitHub CLI / GitHub connector | Repository setup, secrets, variables, pull requests, CI status. |
| Playwright MCP | Browser checks, signup flows, visual inspection, widget verification. |
| Sentry CLI | Project verification, future releases and source maps. |
| OpenAI API | Clarification, spec generation, and implementation-agent support. |

## Rules

- Do not commit credentials, cookies, API keys, Sentry tokens, or private DSNs.
- Store local machine credentials under `/root/.secrets` or provider-specific config outside the repo.
- Use GitHub Actions secrets for CI credentials.
- Use GitHub Actions variables for non-secret provider identifiers.
- Record only secret names in repository docs.

## Expected GitHub Secrets

- `OPENAI_API_KEY`
- `SENTRY_AUTH_TOKEN`
- `SENTRY_DSN`

## Expected GitHub Variables

- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_URL`
