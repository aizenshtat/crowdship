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
- sample-only votes or comments in production paths
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

## Mobile-First And PWA

Crowdship should be comfortable from a phone before it is optimized for desktop. The widget will often be opened from a mobile product screen, and the admin/core review dashboard should be usable from a phone when maintainers need to approve, reject, or inspect a preview away from a laptop.

Mobile-first requirements:

- Design the widget flow at 390x844 before expanding to desktop.
- Keep the launcher reachable by thumb without covering host-app primary actions.
- Use bottom-sheet or full-screen mobile patterns for request compose, chat, spec approval, preview review, voting, and comments.
- Keep all primary decision actions visible without horizontal scrolling.
- Make attachment upload, screenshot review, and removal comfortable with touch.
- Use minimum 44px touch targets for primary controls, icon buttons, chips, and timeline actions.
- Keep chat input stable when the virtual keyboard opens.
- Preserve progress context when users background the browser or return from opening a preview link.
- Let admins review contribution details, Sentry evidence, preview status, and merge-readiness from mobile.

PWA direction:

- Crowdship admin should be installable as a PWA with a manifest, icons, `display: standalone`, service worker, offline shell, and app-safe routing.
- The installed PWA should support Home Screen bookmarking so iPhone users can launch Crowdship like an app without an app store.
- Push notifications should be used for meaningful contribution events: spec needs approval, preview ready, revision requested, voting threshold reached, core review needed, production shipped.
- On iOS/iPadOS, Web Push is for Home Screen web apps and notification permission must be requested from a direct user interaction.
- No silent push assumptions: notifications must be user-visible and respectful.
- The first admin notification slice may start with local browser notifications and badge updates while richer push plumbing is still pending, but it still needs per-project controls and quiet mode.
- Notification settings must include quiet modes and per-project controls.
- Badge counts should represent actionable items, not vanity activity.

Do not hide critical workflows behind desktop-only tables, hover-only controls, or wide dashboards.

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

Mobile/PWA checks:

- Mobile admin review at 390x844.
- Widget with virtual keyboard open.
- Widget after returning from preview.
- Installable manifest and service worker once the PWA shell exists.
- Notification permission prompt triggered only by a user action.
- Badge count clears when actionable items are resolved.

## CI And Local Enforcement

The repository enforces baseline quality with:

- `npm run quality`
- `npm test`
- `npm run lint`
- `.githooks/pre-commit`
- GitHub Actions quality workflow

Playwright visual checks will become mandatory as soon as the first real UI implementation lands.

## Platform References

- WebKit: [Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
- Apple Developer: [Sending web push notifications in web apps and browsers](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).
- MDN: [Installing Progressive Web Apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing).
