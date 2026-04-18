---
name: crowdship-ui-ux
description: Use when designing or implementing Crowdship user-facing UI, especially the widget, clarification chat, spec approval, progress timeline, voting/commenting, and admin dashboard. Enforces the product's no-simulation UX, high first-impression bar, visual system constraints, and Playwright verification.
---

# Crowdship UI/UX

## Core Promise

Crowdship must feel like a serious product contribution cockpit, not a help bubble or generic feedback form.

Every user-facing state must make the user understand:

- what they can do now
- what the agent is doing
- what artifact exists
- what decision is needed
- what happens next

## Mandatory Reads

Read these references only as needed:

- `references/visual-language.md` for style, typography, color, and layout rules.
- `references/widget-surfaces.md` for widget-specific surfaces and states.
- `references/quality-gates.md` before declaring UI work complete.
- `references/copywriting.md` when writing user-facing text.

## Workflow

1. Identify the surface: widget, admin dashboard, example app embed, preview review, voting, or notification.
2. Read the matching reference file.
3. Design the actual product experience first. Do not create marketing-first screens.
4. Keep UI state-backed. Do not show fake progress, fake preview links, fake CI, or fake agent activity.
5. Implement with stable layout dimensions for chat, cards, attachments, timelines, and vote/comment rows.
6. Run desktop and mobile Playwright checks before calling the UI done.
7. Fix visual defects before continuing to backend polish.

## Non-Negotiables

- No simulation in the product UI.
- No decorative card nesting.
- No generic "Submit", "OK", "Cancel", or "Save" CTA labels.
- No dominant purple/blue gradients, beige themes, dark slate dashboards, or generic AI startup palette.
- No layout jump when chat messages, attachments, progress items, or comments arrive.
- No icon-only actions without accessible labels.
- No user-facing text that explains the UI instead of helping the user act.
