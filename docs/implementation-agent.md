# Implementation Agent

## Purpose

The implementation agent turns an approved contribution spec into a real branch, pull request, and preview deployment in the target repository.

The agent never runs directly from an unapproved user prompt.

## Inputs

- Approved spec version.
- Contribution ID.
- Project configuration.
- Repository URL.
- Branch naming policy.
- Safe app context.
- Attachments referenced by the spec.
- Admin-configured agent permissions.

## Branch Naming

```text
crowdship/<contribution-id>-<short-slug>
```

Example:

```text
crowdship/ctrb-123-export-filtered-reports
```

## Required Steps

1. Mark job `agent_running`.
2. Fetch latest target repository default branch.
3. Create a feature branch.
4. Inspect relevant code.
5. Implement the narrow approved spec.
6. Update documentation or user guidance when needed.
7. Add or update tests when the change has testable logic.
8. Run verification commands.
9. Commit with a contribution-linked message.
10. Push the branch.
11. Open or update the PR.
12. Store PR URL and branch name.
13. Wait for preview deployment status.

## Progress Events

The worker emits events that the widget can display:

```json
{
  "contributionId": "ctrb_123",
  "kind": "agent_step",
  "status": "running",
  "message": "Adding CSV export action to the reports page.",
  "externalUrl": null
}
```

Important event kinds:

- `job_queued`
- `agent_step`
- `verification_started`
- `verification_finished`
- `branch_pushed`
- `pr_opened`
- `ci_started`
- `ci_finished`
- `preview_ready`
- `revision_started`
- `revision_finished`

## Pull Request Contract

PR title:

```text
Crowdship: <approved spec title>
```

PR body must include:

- Contribution ID.
- Approved spec summary.
- Acceptance criteria.
- Verification results.
- Preview URL when available.
- Link back to Crowdship admin view.

## Revision Contract

If the requester asks for changes:

- Create a new spec version if scope changes.
- Continue on the same branch when possible.
- Update the existing PR.
- Preserve the previous preview record.
- Deploy a new preview.

## Failure Handling

Failures are real states, not hidden details.

- CI failure: show failing check and logs link.
- Agent failure: show summarized error and retry option.
- Preview failure: keep PR link visible and show deployment failure.
- Scope conflict: ask requester/admin whether to split the request.
