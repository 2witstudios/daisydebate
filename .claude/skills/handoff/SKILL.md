---
name: handoff
description: >
  Hand a slice PR to async review in one step: push the branch, open or update the one PR through
  /pr, move the delivered tasks to In Review, spawn the /review and /code-review reviewers into
  your own worktree, ask the architecture reviewer for a pass, and post on the Delivery channel. Use when a
  slice PR opens, when the user says "/handoff", or at the end of a builder prompt.
compatibility: Requires git, the gh CLI, pu, and the pagespace CLI with an active key. In a repository with bun board:* (Daisy) it uses them.
---

# 🤝 handoff

Act as a slice builder opening its PR to review. A handoff is one step: every part below happens in
the same run, in this order, and the run is not done until each part is verified. It starts the
review, and the PR loop that follows converges it.

Constraints {
Never merge and never mark Done. Only main receives merged PRs; the point guard's flow sweep merges after you emit PR_READY.
Never edit the criteria of a task delegated to you.
Report checks honestly: exact SHA, commands run, NOT RUN with the reason. Never an inferred pass.
Scratch files carry the branch name (`<scratchpad>/handoff-<branch with / replaced by ->.md`), never a shared name.
Never put secrets, tokens, cookies or .env material in a page, PR or message.
}

Process {

1. Commit everything that belongs to the branch; `git status --short` shows nothing of yours. Record `HEAD` (the full 40-character SHA).
2. Push: `git push -u origin HEAD` (never --no-verify).
3. PR: run /pr for the branch. It names every task code, links the plan and the mission prompt, and verifies the published body.
4. Status: move each delivered task to In Review (`bun board:status <taskPageId> in_review` when present). Add the PR to each task's Related pages and to the plan.
5. Reviewers: spawn both into your own worktree and note their agent ids:
   `pu spawn --agent claude -w <your worktree id> "/review <PR url>"`
   `pu spawn --agent claude -w <your worktree id> "/code-review <PR url>"`
   They are read-only and post PR comments. Kill each one (`pu kill --agent <id>`) once it has posted.
6. Channel: one message asking the architecture reviewer for a pass and telling the point guard the PR is open:
   `pagespace channels send <Delivery channel id> "<slice> (<agent id>): PR <url> open for <CODES>; @<architecture reviewer> architecture pass please; PR loop starting."`
7. Verify: `gh pr view <n> --json headRefOid` equals the SHA from step 1, the tasks read In Review, and both reviewers are running. Then start (or continue) the PR loop.
   }

Commands {
🤝 /handoff [task codes…] - run every step above for the current branch
}
