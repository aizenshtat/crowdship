# Demo Script

## Setup

- `example.aizenshtat.eu` acts as a customer-owned external app.
- `crowdship.aizenshtat.eu` owns the widget and contribution workflow.
- The example app embeds the Crowdship widget.
- Every visible progress state is real: persisted contribution, agent transcript, branch, PR, CI run, preview deploy, and merge.

## Story

1. Open the example app as a normal user.
2. Hit a realistic product limitation, such as needing to export a report or request a workflow change.
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

## Demo Contribution

```text
Title: Export filtered reports as CSV

Problem:
I filter reports by customer segment every Friday, but I have to manually copy the table into a spreadsheet before sending it to finance.

Expected behavior:
Add an Export CSV button that respects the current filters.

Why it matters:
This saves around 20 minutes every week and avoids mistakes.
```

## Owner Output

```text
User problem:
Customers need to export filtered report data for offline finance workflows.

Acceptance criteria:
- Reports page includes an Export CSV action.
- Export respects currently applied filters.
- CSV includes visible table columns.
- Empty result exports include headers.
- Export failures show a recoverable error.

Non-goals:
- Scheduled exports.
- XLSX support.
- Permission changes.
```

## Required Real Artifacts

The demo is incomplete unless it can show:

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

## Judge Message

Crowdship turns customers from passive feedback sources into structured product contributors, while preserving the owner-controlled code boundary that makes `cc-workspace` safe for private work.
