---
name: orchestrate
description: Run the slice process as point guard — mission-only briefs, one Claude builder per semantic slice, one plan confirmation, and the flow sweep that merges PR_READY slices.
---

# Orchestrate

Read AGENTS.md and [the slice process](../../../docs/development/agent-pipeline.md).
The owner's request to implement an outcome authorizes slicing, spawning,
confirmation and merging within it; planning-only requests stay planning-only.

1. **Slice.** Cut the outcome into semantic slices wide enough that no builder
   needs to know what another is doing. Merge thin lanes into one owner.
2. **Brief.** Write a mission-only brief of about ten lines per slice: the outcome,
   the drive intent pages and ADRs that own it, the PRs and branches it inherits,
   and the autonomy rules. Never research on a builder's behalf. Publish briefs
   in the drive's `Prompts` folder.
3. **Spawn.** One Claude builder per slice: `pu spawn --agent claude --name
<slice> "<brief>"` (Claude, because the Ralph loop runs on Claude Code's Stop
   hook). Hand each builder its inherited PRs and branches; tell retiring sessions
   to finish or hand over, then `pu kill` and `pu clean` them in one pass.
4. **Confirm once.** When a builder posts its plan on the channel, confirm or
   redirect within minutes, alongside the architecture reviewer. Answer product,
   architecture and scope questions on the channel immediately and record each
   with `bun decision:record`. There is no later approval relay.
5. **Merge.** The flow sweep merges a PR when its builder has emitted `PR_READY`
   and the required checks are green at the exact head, at most two per cycle.
   After a batch, run a local typecheck and knip on main. Only main receives
   merged PRs.
6. **Retire.** When a slice merges, its builder posts `SLICE DONE` or its next plan;
   kill finished sessions and their reviewers.

Production identity, secrets, production deploys and production data stay with
the owner. Never kill or clean another session's work without handing it over
first. Context exhaustion means recording progress and continuing, not
abandoning the outcome.
