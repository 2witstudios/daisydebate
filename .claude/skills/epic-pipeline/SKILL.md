---
name: epic-pipeline
description: Carry an owner-authorized slice or epic through the slice process — discovery and plan, one confirmation, one PR, the Ralph loop and async reviews.
---

# Epic pipeline

Read AGENTS.md and [the slice process](../../../docs/development/agent-pipeline.md).
The owner's implementation request authorizes execution within that outcome; a
planning-only request stays planning-only.

1. **Discover and plan** with [the task workflow](../task/SKILL.md): your own
   discovery, one plan with a task list in `Plans/<slice>`, and its link posted on
   the pu channel.
2. **Confirm once.** The architecture reviewer and the point guard confirm or
   redirect. Start building at once on anything their answer cannot change.
3. **Build one PR.** Build the whole slice on one branch, carrying inherited
   commits into it, and open one PR with [/pr](../pr/SKILL.md). Hand it to review
   with [/handoff](../handoff/SKILL.md).
4. **Converge.** Run the owner's Ralph loop (PageSpace `p4xbp1iwavowuruqpi5fguf7`,
   verbatim) until it emits `PR_READY`. Its iterations consume the `/review`,
   `/code-review` and architecture comments.
5. **Close.** After the flow sweep merges, post `SLICE DONE` or your next plan on
   the channel.

Escalate product, architecture or scope questions to the point guard on the
channel and continue unaffected work. Production identity, secrets, deploys and
data stay with the owner.

`/epic-pipeline <outcome>` resumes the first unfinished step.
