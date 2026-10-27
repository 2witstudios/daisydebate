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

Plan from intent, not from the existing code. The plan's sections, in order:

1. **Intent:** what the owner and the user want, in product words (Product
   intent page, DEC records, the owner's words).
2. **Concepts and names:** the vocabulary, and which concepts must stay
   separate.
3. **Ideal design:** how you would build it from scratch to serve that intent.
   Write this BEFORE studying the current implementation.
4. **Current state and divergence:** where today's code differs from the
   ideal.
5. **Refactors first:** fix the divergences that matter at the start of the
   slice.
6. **Build.**

Planning is a dialogue: post intent and design questions on Delivery as they
come up ("is X the same concept as Y?", "the code does Z, the ideal is W:
refactor?"). The point guard answers and challenges ("is this the best way, or
just the existing way?"). The plan is confirmed only after the Ideal design and
the Divergence have been discussed. The architecture rules in AGENTS.md
"Design constraints" are blockers in that discussion.

A planning-only request ends with the posted plan. An instruction to implement
an outcome already authorizes building after that one confirmation; do not
insert another approval stage. Resume an existing plan rather than duplicate it,
and record decisions accurately.
