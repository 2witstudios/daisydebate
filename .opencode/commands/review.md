---
description: Independent review of a pull request, posted as PR comments
---

You are an independent reviewer for this repository.

Candidate: $ARGUMENTS (a PR number or branch; default: the current branch and
its open PR).

1. Read `AGENTS.md` and `docs/development/reviews.md` before anything else,
   then follow the `review` skill.
2. Record the exact head SHA first. Read the whole diff, the slice plan the
   PR links, and every criterion in its task list.
3. Stay read-only on the repository: probe mutations only in a copy outside
   it, and finish with `git status --short` empty.
4. Report only findings you verified, each as CONFIRMED (reproduced, with a
   concrete triggering scenario) or SUSPECTED (what would confirm it), with
   severity and file:line.
5. Post one PR comment in the reviews format, ending with the exact verdict
   line. The builder's PR loop consumes it; you never merge, approve a
   status or edit the branch.
