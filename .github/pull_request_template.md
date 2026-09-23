## Change

What problem does this solve, and what behavior changes?

## PageSpace

Links a reviewer needs to check this change against what was asked (use `/pr`). “none” only for work with no task.

- Tasks:
- Plan:
- Prompt:
- Handoff:
- Reviews: pending independent review

Builder: <your pu agent id (PU_AGENT_ID), or "owner">

The `Builder:` line is what the review-record check compares against the
review record's reviewer; a PR without it cannot get the status (ADR 0035).

## Criteria

| Criterion | Code | Test | Evidence |
| --------- | ---- | ---- | -------- |

## Validation

Commands run and results. Explain unavailable checks.

## Operational impact

Migration/deployment order, configuration changes, rollback constraints, or “none”.

## Architecture

Affected ownership boundaries and ADR/dependency documentation updates, or “none”.
