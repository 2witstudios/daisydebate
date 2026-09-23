# Review records

A review record is the durable artifact of reviewing one change. It lives in
the Daisy Debate PageSpace drive (attach it to the task or post it to the
designated channel), not in the repository — point-in-time documents rot
into misinformation when committed at the root. The template below is the
contract; keep sections in this order.

```markdown
# Review: <task or PR title> (<branch>)

## Gates run

bun check: PASS (format, lint, policy, knip, duplication, invariants, evidence, typecheck,
unit tests, metrics, build) · bun migrations:check: PASS · date

## Findings

- [ ] blocker · <file>:<line> · <why it must not merge> · <fix commit or PR note>
- [ ] major · <file>:<line> · <why> · <fix>
- [ ] minor · <file>:<line> · <why> · <fix>
- [ ] nit · <file>:<line> · <why> · <fix>

Only check a finding once its fix is verified in the code, not when the
fix is claimed.

Where an unfixed finding goes: if the leaf it belongs to is still open, a
follow-up leaf under that phase; if the leaf is Done, the PR is merged, or
the owner chose not to block on it, an `ISSUE-n` task in the drive-root
`Issues` list (never a GitHub Issue) that names this record as its origin.
Say which in the finding's fix column.

## What is good

<two or three specific things worth keeping>

## Verdict

<n blocker / n major / n minor / n nit> — <ALL RESOLVED | CHANGES REQUESTED>
```

Rules:

- A second-pass review re-verifies the first pass finding by finding
  before declaring ALL RESOLVED.
- Record environment gotchas discovered during review (stale builds,
  shared stacks, port collisions) — they are the next reviewer's
  parallel-work traps.
- Plan compliance is a separate discipline: extract every
  "Given X, should Y" acceptance criterion from the task and mark each
  PASS/FAIL/PARTIAL against the diff before writing a verdict.
