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

## Privacy & telemetry

See [ADR 0036](docs/decisions/0036-privacy-by-design.md),
[ADR 0037](docs/decisions/0037-error-tracking-and-product-analytics.md) and
[privacy](docs/operations/privacy.md). “none” only when this change adds no
log field, database/Redis column, or analytics event.

- Columns classified (inventory entry: category, visibility, purpose,
  lawful basis, storage, owner, retention, erasure):
- Events registered (log or analytics event registry entry):
- No personal data in telemetry (no `personal`/`sensitive`/`secret` field
  reaches a log, error report or analytics event):
- Retention and erasure defined for any new personal-data column:
- Consent category declared for any new client-side tracking:
