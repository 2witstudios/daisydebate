# 0065: Branch autonomy and main acceptance

Status: proposed for main acceptance; implementation authorized by the owner on 2026-10-09.

## Context

The owner requested a comprehensive pipeline refactor after an audit of local
Claude Code and Codex conversations. The audit found repeated approval polling,
main-first dependency sequencing, integration demanded for documentation-only
reviews, parent Git dirtiness mistaken for launcher failure, and repeated agent
handoff acknowledgments. These rules prevented long-running agents from carrying
an already requested outcome to completion.

## Decision

Owner-authorized branch delivery includes planning, task administration,
experimentation, provisional producer integration, autonomous PurePoint
delegation, independent branch feedback, review fixes and continuation. Agents
preserve the requested outcome and coordinate actual writer conflicts. They
record provisional assumptions and deferred proof without turning each step
into another owner approval. Acceptance and production authority are separate.

The executable checks and the operating procedure are in
[the delivery pipeline](../development/agent-pipeline.md). Main retains completed
transitions, architecture/security checks, applicable tests, migration integrity
and independent exact-candidate review. Production retains explicit human
identity, secret, data and deployment sign-offs. The optional branch push hook
allows provisional snapshots; main pushes require an exact clean candidate and
the full gate. No GitHub protection or production rail is removed.

Doctor validates the effective launcher configuration and usable identity
launcher instead of parent Git cleanliness (ISSUE-386). Other environment and
identity checks remain independent and truthful.

Documentation evidence follows the existing DEC-125 proposal: classify the
actual live diff and both Git tree modes, fail closed on ineligible or unknown
facts, and require independent documentation review plus nonservice checks and
an applicable negative control. Runtime approval still requires integration and
negative proof regardless of whether a minor finding is present. Explicit
branch-feedback records cannot grant main acceptance.

This implements the pipeline distinction proposed in messaging ADR 0064 without
changing its product decisions or the messaging writer's source. Previously
published reviews retain their historical results; this branch does not forge
PASS evidence or make outstanding human prerequisites complete.

## Consequences

Agents own execution within the owner's direction and report meaningful outcomes
or real blockers. PageSpace remains the delivery record, not a second permission
system. Intermediate failures remain visible and must be discharged before main
acceptance. Shared skills, live Library prompts and init-offense seed sources
carry the same rule so new projects and new sessions inherit the correction.
