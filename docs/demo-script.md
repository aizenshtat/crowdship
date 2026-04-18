# Product Walkthrough

## Setup

- `example.aizenshtat.eu` acts as a customer-owned external app.
- `crowdship.aizenshtat.eu` owns the widget and contribution workflow.
- Orbital Ops embeds the Crowdship widget.
- Every visible progress state is real: persisted contribution, agent transcript, branch, PR, CI run, preview deploy, and merge.

## Story

1. Open Orbital Ops as a normal user.
2. Hit a realistic mission-control limitation, such as needing to replay a specific signal drop anomaly.
3. Open the Crowdship widget inside the app.
4. Submit a feature request with page context.
5. Answer the agent's structured clarification questions.
6. Approve the generated specification.
7. Watch the implementation job create a real branch and PR in the example repo.
8. Wait for CI/CD to deploy a real preview URL.
9. Test the preview from inside the widget.
10. Approve the preview or request a revision through chat.
11. Put the approved feature candidate out for voting.
12. Show other users voting and commenting on the working preview.
13. Show the admin/core team view for merge review.
14. Merge the PR and show production deployment.
15. Notify the requester and voters with an AI-generated completion explanation.

## Structured Output

The request is converted into structured product intent:
   - summary
   - user problem
   - affected route
   - suggested acceptance criteria
   - risk notes
   - branch URL
   - PR URL
   - preview URL

Explain that the contributor never saw the private source code.

## Seed Contribution

```text
Title: Add anomaly replay for signal drops

Problem:
I need to replay the latest signal drop from the mission screen so I can inspect the anomaly trail without leaving Orbital Ops.

Expected behavior:
Add a replay flow that reopens the selected anomaly, preserves its mission context, and makes the drop sequence easy to review.

Why it matters:
It helps the ops team diagnose signal issues without losing mission context.
```

## Owner Output

```text
User problem:
Ops users need to replay a signal drop anomaly without losing mission context.

Acceptance criteria:
- Mission screen exposes a replay entry point for the selected anomaly.
- Replay stays scoped to `route: /mission` and `selectedObjectType: anomaly`.
- The selected object id is `signal-drop-17`.
- Replay shows the anomaly trail and the current mission context.
- Empty state explains how to open a signal drop for review.

Non-goals:
- Live telemetry reconstruction.
- New mission permissions.
- Backend replay storage beyond the scaffold contract.
```

## Required Real Artifacts

The walkthrough is incomplete unless it can show:

- Contribution ID in Crowdship.
- Chat transcript.
- Approved spec version.
- Example repo branch.
- Example repo PR.
- Passing or failing CI result.
- Preview URL.
- Requester approval event.
- Voting state.
- Admin merge decision.

## Core Message

Crowdship turns customers from passive feedback sources into structured product contributors, while preserving the owner-controlled code boundary that makes `cc-workspace` safe for private work.
