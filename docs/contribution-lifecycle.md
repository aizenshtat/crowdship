# Contribution Lifecycle

## State Machine

```text
draft_chat
spec_pending_approval
spec_approved
agent_queued
agent_running
pr_opened
preview_deploying
preview_ready
requester_review
revision_requested
ready_for_voting
voting_open
core_team_flagged
core_review
merged
production_deploying
completed
rejected
```

## State Definitions

| State | Meaning |
| --- | --- |
| `draft_chat` | User is describing the request and answering clarification questions. |
| `spec_pending_approval` | Agent has generated a short spec and waits for user approval. |
| `spec_approved` | User approved a spec version. |
| `agent_queued` | Implementation job is waiting for a worker. |
| `agent_running` | Worker is editing code, docs, tests, or config. |
| `pr_opened` | A real PR exists in the target repository. |
| `preview_deploying` | CI/CD is building and deploying the PR preview. |
| `preview_ready` | A real preview URL is available. |
| `requester_review` | Original requester is testing the preview. |
| `revision_requested` | Requester asked for changes after preview testing. |
| `ready_for_voting` | Requester approved the preview. |
| `voting_open` | Other users can test, vote, and comment. |
| `core_team_flagged` | Vote threshold or admin action flagged it for maintainers. |
| `core_review` | Core team is validating the PR and product fit. |
| `merged` | PR was merged. |
| `production_deploying` | Main branch CI/CD is deploying production. |
| `completed` | Feature is live and notifications were sent. |
| `rejected` | Owner or core team rejected the request. |

## Requester Approval Rules

- Implementation cannot start before the requester approves a spec version.
- Voting cannot start before the requester approves the preview.
- Requester revision requests update the same branch and PR when feasible.
- Major scope changes should create a new spec version.

## Comment Dispositions

Comments from other users are tracked with disposition:

| Disposition | Meaning |
| --- | --- |
| `needs_requester_review` | The comment proposes a refinement. |
| `incorporated` | The requester or admin approved it and the branch includes it. |
| `rejected` | It was considered but not accepted. |
| `split_to_new_request` | It is valuable but belongs in a separate contribution. |
| `superseded` | Later conversation made it obsolete. |

Comment authors should be able to see what happened to their suggestion.

## Completion Explanation

When a contribution is completed, Crowdship generates a short user-facing explanation:

- What changed.
- Where to find it.
- Which comments were incorporated.
- What was intentionally left out.

This explanation is sent to the requester, voters, and commenters.
