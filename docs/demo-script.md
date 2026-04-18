# Demo Script

## Setup

- `example.aizenshtat.eu` acts as a customer-owned external app.
- `crowdship.aizenshtat.eu` owns the widget and contribution workflow.
- The example app embeds a future Crowdship widget.

## Story

1. Open the example app as a normal user.
2. Hit a realistic product limitation, such as needing to export a report or request a workflow change.
3. Open the Crowdship widget inside the app.
4. Submit a feature request with page context.
5. Switch to the owner view in Crowdship.
6. Show the request converted into structured product intent:
   - summary
   - user problem
   - affected route
   - suggested acceptance criteria
   - risk notes
7. Explain that the contributor never saw the private source code.
8. Explain that the owner can later approve an agent workflow in their private environment.

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

## Judge Message

Crowdship turns customers from passive feedback sources into structured product contributors, while preserving the owner-controlled code boundary that makes `cc-workspace` safe for private work.
