# UI Quality Contract

Crowdship needs a strong first impression because the product asks users to trust an agent with a real product contribution. The interface must feel operational, specific, and verifiable from the first screen.

## No Simulation Rule

User-facing UI must never imply work that is not backed by a real artifact or real system state.

Allowed:

- draft specification generated from a real conversation
- queued implementation with a real contribution id
- running implementation with a real branch name
- preview-ready state with a responding preview URL
- PR-ready state with a real pull request URL

Blocked:

- fake progress bars
- placeholder preview links
- simulated agent logs
- demo-only votes or comments in production paths
- optimistic "deployed" states before health checks pass

## Surfaces

The initial product surfaces are:

- Widget launcher
- Request composer with attachments
- Clarification chat
- Spec approval
- Contribution list
- Agent progress timeline
- Preview review
- Voting and comments
- Admin dashboard

Each surface must define empty, loading, error, blocked, and success states before implementation starts.

## Interaction Principles

- The primary action must be specific: "Approve spec", "Request changes", "Open preview", "Send to vote".
- Users must always see what happens next.
- Long user text, screenshots, comments, and generated criteria must not break layout.
- Users must be able to recover from attachment upload, preview, and implementation failures.
- Keyboard access is mandatory for widget open, compose, approval, voting, and admin actions.
- Destructive or irreversible actions need explicit language and a confirmation step.

## Visual Principles

- Use crisp surfaces, restrained contrast, and high information clarity.
- Do not use dominant purple/blue gradients, beige themes, dark slate dashboards, decorative blobs, or nested cards.
- Use cards only for repeated artifacts such as specs, PRs, comments, previews, and modals.
- Keep card radius at 8px or less.
- Use stable dimensions for chat, timelines, attachment rows, votes, comments, and admin tables.
- Reserve accent color for primary action, active state, focus ring, and live status.

## Required Checks

Before user-facing UI is considered done, run:

- Desktop screenshot at 1440x900
- Mobile screenshot at 390x844
- Narrow widget screenshot at 360x720
- Keyboard path through the main action
- Long text stress case
- Multiple attachment stress case
- Empty list state
- Loading state
- Error state
- Secret scan of rendered HTML and console output

## CI And Local Enforcement

The repository enforces baseline quality with:

- `npm run quality`
- `npm test`
- `npm run lint`
- `.githooks/pre-commit`
- GitHub Actions quality workflow

Playwright visual checks will become mandatory as soon as the first real UI implementation lands.
