# 0057: declared planned readers

Status: accepted (owner request, 2026-10-06). Extends
[ADR 0013](0013-knip-dead-code-gate.md) and [ADR 0023](0023-greenfield-baseline.md).

## Context

The AIDD strategy is to build foundations in shared, organized boxes for work
that is committed but not yet built. Neither the dead-code gate nor
`AGENTS.md`'s "shared abstractions require two real consumers" can tell that
from an abandoned experiment, so a foundation whose reader is a leaf away has
two bad options: build the box and its reader in one change, or let the box
pass unnoticed.

The second option is what already happened, and it is worth being precise about
how, because it bounds what this mechanism can do. `role_grants` is a fully
constrained, integration-tested table that **no runtime code reads**; it
survives `bun run knip` because `schema.test.ts` and
`competitive-constraints.integration.ts` happen to reference it. A test is
standing in for a feature, so nothing distinguishes a deliberate foundation
from something nobody will ever adopt. `createBrowserConnectionStore` and the
outbox drain's no-op sink are the same shape.

So the gap this closes is narrow and real: **the dead-code gate counts a test as
a consumer, and a test is not the consumer anyone means.** The gate stays right
— an export nothing reads at all should still fail — but its passing tells you
nothing about whether a foundation is adopted. The missing thing is the ability
to say "this export has no production reader yet, here is the task that will
read it, and here is the date it is judged by".

## Decision

1. **A foundation may ship before its runtime reader, by declaration.**
   `policy/planned-readers.json` records one named export per entry with
   `path`, `export`, `task`, `owner`, `adr`, `reason` and `reviewBy`. `task`
   is the committed task that will read it, so a declaration names a reader
   rather than asserting one. No wildcard paths: a declaration covers one
   export.
2. **`bun policy` validates the registry**, not the code. `validatePlannedReaders`
   (`scripts/planned-readers.ts`) requires every field, refuses an entry that is
   not an object, refuses a path or ADR that does not exist, refuses a malformed
   ADR reference, refuses a duplicate `path|export`, proves the file actually
   exports the named symbol, and reuses the shared `reviewDateStatus` rule so a
   declaration's date is judged exactly as an exception's is. The export check is
   what keeps the registry authoritative: without it `{"path": "...", "export":
"madeUpThing"}` validates, and a list that can name a fiction is not a list of
   foundations awaiting readers.
3. **`reviewBy` has teeth.** A declaration fails the gate the day after its
   review date. A foundation nobody adopts goes red again instead of sitting
   in the repository indefinitely. That is the ADR 0023 difference between a
   planned surface and a compat remnant, expressed as a date.
4. **It is a declaration, not a suppression, and it covers a narrower case than
   "an unused export may ship".** Knip still fails an export nothing reads; this
   registry does not touch Knip. In practice a declared export already has _some_
   syntactic consumer — a test, an integration suite, a harness — which is why
   the dead-code gate was passing it while its intended runtime reader was still
   a committed leaf away. These are **planned runtime readers**: the entry means
   "consumed only by tests today, production consumer named and dated." It is not
   a permission for a genuinely unread export to ship.
5. **Existing orphans are declared, not hidden.** `createBrowserConnectionStore`
   and `startOutboxDrain` are backfilled with their real future readers, so the
   list of foundations without readers is visible and dated from this change
   onward. `roleGrants` is deliberately not declared: it has no future reader to
   name. [ADR 0048](0048-authorization-core.md) records that `authorize` never
   reads it and that LEAGUE-OPS will replace or drop it when grant tables land,
   and [ADR 0058](0058-one-round-model.md) keeps it unread pending a separate
   membership ADR. Naming a task here would assert a reader no committed leaf
   provides — the exact move decision 1 forbids.
6. **`AGENTS.md`'s "two real consumers" governs shared abstractions being
   invented, not a port or table whose consumer is a committed leaf.** A new
   general-purpose helper still needs two callers; a foundation for a named
   task needs one declared reader.

## Consequences

- A greenfield repository can build its identity, membership and realtime
  foundations before the features that read them, without weakening any gate.
  The list of what is waiting is machine-checked against the source rather than
  maintained by hand, so an entry cannot outlive the export it names.
- This does not close the wider hole: a foundation with _no_ consumer at all is
  still only caught by Knip when nothing references it. Naming that limit is
  part of the decision, so the registry is not later mistaken for a general
  unused-code allowance.
- `policy/planned-readers.json` becomes the standing answer to "which code is
  waiting for a reader, and until when" — previously unanswerable.
- A new declaration is a dated liability. Long-horizon work that slips past
  `reviewBy` needs either a reader or an explicit owner decision to extend,
  which is the intended pressure.
- The registry grows a `task` field the other policy registries do not have,
  because only a planned reader has a future caller to name.
