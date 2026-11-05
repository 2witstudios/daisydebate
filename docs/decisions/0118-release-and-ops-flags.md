# 0118: Release and ops flags

Status: accepted direction under the owner-authorized Billing dependency,
2026-11-05, with point-guard and independent architecture review on Delivery.
Implementation and acceptance evidence remain in the existing
[Flags plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/lhgmff10507jstpixc4mav54).

## Decision

Flags control release and operational admission only. They never grant access,
entitlements, prices or competitive rules. A targeted account still needs the
consumer's current authorization and configuration. Entitlements are durable
grants, not scoped flags; this amends ADR 0075's earlier terminology.

The code catalogue and one pure total resolver belong to `features/flags`.
PostgreSQL facts and transactions belong to `packages/db`. No new package or
vendor is required. Every catalogue entry has a permanent key, kind, owner,
task, expiry/review date, safe default and dependencies. Release safe defaults
are false. Unknown or invalid graphs are off. Killed state wins over targeting;
an unexpired account override precedes stored state and the catalogue default.
Every dependency must be active. A release past its expiry is off at runtime
and fails policy. An override expires logically even if maintenance stops.
Keys and ownership cannot be silently repurposed, and retired keys stay retired.

## Reads and admission

`features/flags/server.ts` publishes
`isReleaseEnabled(key: ReleaseFlagKey, accountId: string | null): Promise<boolean>`.
It is a display read, deduplicated per request only at the React edge. Null means
anonymous with no targeting; an account ID comes from the authenticated server
principal. Only booleans reach UI clients. Client chunks are public. No flag
read belongs in a proxy or a `use cache` scope. Read failures use safe defaults
with bounded diagnostics containing no account or raw error.

A display boolean never authorizes durable work. `releaseAdmission(key)`
derives a bounded, deduplicated dependency closure from the trusted catalogue
and returns the synchronous pure `ReleaseAdmission` policy. The public
`@daisy/db/flags` adapter `requireFlagAdmission(tx, accountId, policy)` locks
and reads plain facts, invokes that policy, and returns `admittedAt`. The
database never imports the web feature.

All writes use this order: command/idempotency gate if applicable, canonical
account fence, transaction-level Flags advisory lock, then Flags rows.
Admissions take shared; changes take exclusive from the outset, never upgrade.
Erasure and targeting use account-before-Flags. Global changes and bounded
sweeps omit the account fence only because they acquire none afterward.

After obtaining the lock, a **separate READ COMMITTED statement** reads facts
and one `clock_timestamp()` sample. A statement begun before a wait or the
transaction-start `now()` would give stale admission evidence. The intent
stores `admittedAt`, then commits under the shared lock. Admission is decided
at that sample, not an unknowable physical commit instant. Other blocking
locks precede it; subsequent writes are minimal. Lock waits, statements and
the whole transaction are bounded. No lock spans vendor I/O.

A completed disable prevents later admissions. An already admitted, bounded,
account-bound and semantically matching attempt follows Billing's idempotent
recovery contract, including a recovery path while the new-purchase route is
dark. Recovery rechecks current account authority; erasure always overrides
continuation. An unresolved outcome never authorizes a replacement attempt.

## Operator and privacy ownership

Only dedicated closed capabilities and resource routes on ADR 0079's private
signed operator API change state or targeting. Reuse its existing nullable
target and action-discriminated command receipts. Expected revisions, command
identity, authorization, signed deadline, state and append-only audit are one
transaction. Participant principals and client-supplied overrides never qualify.
There is no Next operator route, generic command endpoint or admin UI here.

Targeting uses the account-erasure fence. Replaying history must never recreate
erased targeting. The sweep is bounded and uses the same exclusive Flags lock;
revision changes cannot be lost. Override personal data is exported and erased
through the existing privacy adopter. Audit and receipts have explicit purposes
and bounded retention, including operator identifiers and semantic digests;
hashing alone does not make them anonymous. The compliance page owns the actual
classification and retention implementation.

## Delivery boundary

This foundation owns FLAGS-1, FLAGS-2, FLAGS-3, FLAGS-4, FLAGS-5, FLAGS-6,
FLAGS-7, FLAGS-9 and FLAGS-11 plus FLAGS-8's contract and adapter tests.
`premium-checkout` belongs to Billing, references FLAGS-15, defaults false and
expires on 2026-12-04. No production override or live purchase is enabled.
Billing proves the actual route, purchase mutation and public UI for FLAGS-8
and FLAGS-15 after this core merges to main and Billing rebases/regenerates
migrations. Core fixtures do not close those leaves. Portal/cancellation,
webhooks/reconciliation, erasure and existing authorized work remain available.
Admin UI, other-process integration, AI ops consumers and the wider nightly
rollout suite remain their existing separate leaves.

References verified against PostgreSQL 18 (the repository's version):
[isolation](https://www.postgresql.org/docs/18/transaction-iso.html),
[transaction locks](https://www.postgresql.org/docs/18/explicit-locking.html),
[clock functions](https://www.postgresql.org/docs/18/functions-datetime.html),
[transaction and lock bounds](https://www.postgresql.org/docs/18/runtime-config-client.html).
