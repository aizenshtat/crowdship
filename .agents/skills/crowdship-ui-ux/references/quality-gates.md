# Quality Gates

## Before UI Work Starts

- Surface and state are named.
- Required backend state is known.
- Empty/loading/error/disabled states are identified.
- Mobile viewport behavior is known.
- User-facing copy is written before styling.

## Before UI Work Is Done

Run checks:

- Desktop screenshot.
- Mobile screenshot.
- Keyboard navigation for main actions.
- Long text in title, chat, comments, and spec criteria.
- Multiple attachments.
- Empty contribution list.
- Error state.
- Loading state.
- No secret values in rendered HTML.

## Playwright Viewports

Minimum:

- Desktop: 1440x900
- Mobile: 390x844
- Narrow embed: 360x720

## Blocking Issues

- Text overflow.
- Layout jump when state changes.
- Primary CTA below the fold in the widget's main decision states.
- Preview shown before a real preview URL exists.
- Generic CTA labels.
- Color accent used everywhere.
- Missing accessible labels on icon-only controls.
