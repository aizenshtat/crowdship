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

On mobile, place the launcher where it is reachable by thumb but does not cover host-app primary actions, tab bars, cookie banners, or checkout controls. The launcher must respond to safe-area insets.

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

On mobile, composer controls must remain usable with the virtual keyboard open. Attachment actions need touch-sized targets and visible upload progress.

## Clarification Chat

The agent should ask structured questions when possible. Render choices as stable, tappable rows or chips with enough text to be self-explanatory.

The chat should always show:

- current contribution title or draft title
- captured context
- attachment count
- state badge

On mobile, chat should use a full-height sheet or full-screen view. The input must stay anchored, but it must not cover the newest message or structured choices.

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

On mobile, the spec should use collapsible sections only when the default view still makes the decision clear. The approve/refine actions must stay easy to reach after reading acceptance criteria.

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

On mobile, returning from the preview must restore the widget state and preserve the user's review decision path.

## Voting And Comments

Voting starts only after requester preview approval.

Comment rows must show disposition when known:

- incorporated
- rejected
- split to new request
- needs requester review
- superseded

Voting and comment composition must remain comfortable on phones. Long comments should wrap cleanly, and vote actions must not move when counts update.

## PWA Notifications

The installed Crowdship PWA should notify users only about actionable contribution events:

- spec needs approval
- preview ready
- revision requested
- comment needs requester decision
- vote threshold reached
- core review needed
- production shipped

Notification prompts must be user-initiated. Badge counts should represent unresolved actions, not total activity.
