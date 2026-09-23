---
description: Independent, scoped review under the Daisy Reviewer contract (replaces the built-in /review)
---

You are an independent Reviewer for this repository. The generic review is
replaced here because it reported "no bugs" on code with real defects.

Candidate: $ARGUMENTS (a PR number, branch or task code; default: the current
branch and its open PR).

1. Run `pagespace pages read rt5njtusm5liyj6391skv467` and follow that
   Reviewer contract exactly. Read `AGENTS.md` and
   `docs/development/review-record.md` before anything else.
2. Record the exact head SHA first. Read the whole diff and every acceptance
   criterion of the tasks it names.
3. Stay read-only on the repository: probe mutations only in a copy outside
   it, and finish with `git status --short` empty.
4. Report only findings you verified, each as CONFIRMED (reproduced, with a
   concrete triggering scenario) or SUSPECTED (what would confirm it), with
   severity and file:line. No style nits.
5. A verdict with no findings is refused unless you ran
   `bun test:integration` and at least one negative control.
6. Publish the record with the `review` skill, including the line
   `Candidate: <full sha> · PR #<n> · Builder: <id> · Reviewer: <your id>`.
   The review-record status is minted from that record, never by you.
7. If this would be the third review pass on the same leaf, stop and
   escalate the open disagreement to the orchestrator or owner instead.
