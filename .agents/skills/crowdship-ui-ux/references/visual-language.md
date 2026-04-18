# Visual Language

## First Impression

The first impression should communicate competence, safety, and momentum. The product is about turning a real user request into real engineering work, so the UI should feel operational and trustworthy.

Avoid:

- generic SaaS hero layouts
- soft pastel AI blobs
- purple/blue gradient dominance
- beige or dark slate dashboards
- excessive shadows
- cards inside cards

Prefer:

- crisp surfaces
- restrained contrast
- strong typographic hierarchy
- clear artifact blocks
- progress states that look verifiable
- compact but calm density

## Layout

- Use full-width bands or unframed app layouts for primary surfaces.
- Use cards only for repeated items, specs, PR summaries, preview records, comments, and modals.
- Card radius: 8px or less.
- Use a 4px-based spacing system: 4, 8, 16, 24, 32, 48, 64.
- Every dynamic list needs stable row geometry.
- Every fixed control cluster needs stable height.

## Typography

Use no more than four font sizes per implemented surface:

- 13px: metadata, timestamps, compact labels
- 15px or 16px: body and chat
- 20px: section headings
- 28px or 32px: major screen title

Use no more than two weights:

- 400/450 for body
- 600/650 for emphasis and headings

Do not use negative letter spacing. Do not scale type by viewport width.

## Color

Use a 60/30/10 color model:

- 60% quiet product background and main surfaces
- 30% secondary panels, timelines, grouped areas
- 10% accent for primary CTA, active state, focus ring, and live status only

Accent must not be used for every interactive element.

Reserve semantic colors:

- green for successful completion
- amber for user/admin decision needed
- red for destructive or failed states
- neutral for queued/running states unless live state needs accent

## Motion

Motion should confirm state changes, not decorate. Good motion:

- widget open/close
- progress item insertion
- spec approval transition
- preview-ready reveal

Avoid constant animated backgrounds or looping novelty effects.
