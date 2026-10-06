# 0057: declared planned readers

Status: accepted (owner request, 2026-10-06). Extends
[ADR 0013](0013-knip-dead-code-gate.md) and [ADR 0023](0023-greenfield-baseline.md).

## Context

The AIDD strategy is to build foundations in shared, organized boxes for work
that is committed but not yet built. The dead-code gate does not distinguish
that from an abandoned experiment, and neither does `AGENTS.md`'s "shared
abstractions require two real consumers". A foundation whose reader is a leaf
away therefore has two bad options: build the box and its reader in one
change, or let the box pass unnoticed.

The second option is what already happened. `role_grants` is a fully
constrained, integration-tested table that no runtime code reads; it survives
`bun run knip` because `schema.test.ts` and
`competitive-constraints.integration.ts` happen to reference it. A test is
standing in for a feature, so nothing distinguishes a deliberate foundation
from something nobody will ever adopt. `createBrowserConnectionStore` and the
outbox drain's no-op sink are the same shape.

The dead-code gate is right and stays right. The gap is that intent is
undeclarable: there is no way to say "this export has no reader yet, here is
the task that will read it, and here is the date it is judged by".

## Decision

1. **A foundation may ship before its reader, by declaration.**
   `policy/planned-readers.json` records one named export per entry with
   `path`, `export`, `task`, `owner`, `adr`, `reason` and `reviewBy`. `task`
   is the committed task that will read it, so a declaration names a reader
   rather than asserting one. No wildcard paths: a declaration covers one
   export.
2. **`bun policy` validates the registry**, not the code. `validatePlannedReaders`
   (`scripts/planned-readers.ts`) requires every field, refuses a path or ADR
   that does not exist, refuses a malformed ADR reference, refuses a duplicate
   `path|export`, and reuses the shared `reviewDateStatus` rule so a
   declaration's date is judged exactly as an exception's is.
3. **`reviewBy` has teeth.** A declaration fails the gate the day after its
   review date. A foundation nobody adopts goes red again instead of sitting
   in the repository indefinitely. That is the ADR 0023 difference between a
   planned surface and a compat remnant, expressed as a date.
4. **It is a declaration, not a suppression.** Knip still fails an unused
   export; a declared reader is a recorded, dated commitment in the same
   registry shape as `policy/exceptions.json`, whose entries are ADR-linked and
   time-bounded for the same reason.
5. **Existing orphans are declared, not hidden.** `roleGrants`,
   `createBrowserConnectionStore` and `startOutboxDrain` are backfilled with
   their real future readers, so the list of foundations without readers is
   visible and dated from this change onward.
6. **`AGENTS.md`'s "two real consumers" governs shared abstractions being
   invented, not a port or table whose consumer is a committed leaf.** A new
   general-purpose helper still needs two callers; a foundation for a named
   task needs one declared reader.

## Consequences

- A greenfield repository can build its identity, membership and realtime
  foundations before the features that read them, without weakening any gate.
- `policy/planned-readers.json` becomes the standing answer to "which code is
  waiting for a reader, and until when" — previously unanswerable.
- A new declaration is a dated liability. Long-horizon work that slips past
  `reviewBy` needs either a reader or an explicit owner decision to extend,
  which is the intended pressure.
- The registry grows a `task` field the other policy registries do not have,
  because only a planned reader has a future caller to name.
