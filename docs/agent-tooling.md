# Agent Tooling

## Project-Local Skills

The repository vendors project-specific agent guidance under `.agents/skills/`.

Current skills:

- `.agents/skills/crowdship-ui-ux` — UI/UX contract for the widget, admin dashboard, progress timeline, voting, comments, and no-simulation product states.

Agents should read the skill before designing or implementing user-facing UI.

## MCP And Provider Notes

MCP/tool usage is documented in `.agents/mcp/README.md`.

## Git Hooks

This repo includes `.githooks/pre-commit`.

Install locally:

```bash
git config core.hooksPath .githooks
```

The hook runs:

- `scripts/quality-check.sh --staged`
- UI-facing change reminder for Playwright checks

The hook is a guardrail, not a replacement for review.

## Quality Commands

Run before pushing meaningful changes:

```bash
npm run quality
npm test
npm run lint
```

Current checks are intentionally framework-neutral:

- shell syntax validation
- Node built-in contract tests
- whitespace validation
- tracked-file secret scan
- UI contract presence checks

Playwright visual checks become mandatory once real UI lands.
