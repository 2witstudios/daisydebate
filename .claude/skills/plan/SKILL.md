---
name: plan
description: Write the one slice plan with its task list after your own discovery and post it for one confirmation; continue building only within an existing implementation instruction.
---

# Plan

Use [the task workflow](../task/SKILL.md) and [the slice process](../../../docs/development/agent-pipeline.md)
as the source of truth. Do your own discovery: AGENTS.md, the drive's product
intent and constraints, the relevant architecture and ADRs, the `Issues` buckets
touching the slice, and the PRs and branches you inherit. Write one plan with a
task list in `Plans/<slice>` and post its link on the PageSpace Delivery channel for one
confirmation by the architecture reviewer and the point guard.

Plan from intent, not from the existing code: the plan's sections and the
planning dialogue are in the task workflow's plan() step. The repository's
architecture rules (Daisy: AGENTS.md "Architecture rules") are blockers in that
discussion.

A planning-only request ends with the posted plan. An instruction to implement
an outcome already authorizes building after that one confirmation; do not
insert another approval stage. Resume an existing plan rather than duplicate it,
and record decisions accurately.
