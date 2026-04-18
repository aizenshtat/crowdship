# Widget Surfaces

## Required Surfaces

The widget owns these user-facing surfaces:

- launcher
- request composer
- attachment tray
- clarification chat
- structured question cards
- spec approval
- implementation progress
- preview review
- voting
- comments
- notification/completion view

## Launcher

The launcher should be visible but not noisy. It should communicate contribution, not support chat.

Preferred labels:

- "Improve this"
- "Suggest a change"
- "Contribute feature"

Avoid:

- "Help"
- "Support"
- "Feedback"

## Request Composer

The first input should ask for a concrete outcome:

```text
What should this product do better?
```

Support screenshots and attachments as first-class inputs. The attachment tray must show upload state, file type, and remove action.

## Clarification Chat

The agent should ask structured questions when possible. Render choices as stable, tappable rows or chips with enough text to be self-explanatory.

The chat should always show:

- current contribution title or draft title
- captured context
- attachment count
- state badge

## Spec Approval

The spec approval surface is the main trust moment.

It must show:

- goal
- user problem
- acceptance criteria
- non-goals
- affected route/context
- attachments

Primary CTA:

```text
Approve Spec
```

Secondary action:

```text
Refine Spec
```

## Progress Timeline

Each event must map to a real backend or external-system event.

Good timeline labels:

- "Branch created"
- "Pull request opened"
- "Checks running"
- "Preview deployed"
- "Requester approved"
- "Voting opened"

Do not display vague fake progress like "Analyzing magic" or "Almost there".

## Preview Review

The preview review must make the preview link primary.

Actions:

- "Open Preview"
- "Approve Preview"
- "Request Changes"

Revision requests return to chat and update the same contribution.

## Voting And Comments

Voting starts only after requester preview approval.

Comment rows must show disposition when known:

- incorporated
- rejected
- split to new request
- needs requester review
- superseded
