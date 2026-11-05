# 0117: Premium billing through Stripe and the existing allowance boundary

Status: implementation in progress under the owner's 2026-11-04 authorization.
The [existing Billing plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/f3nh50c4v2qsrr2b2ixnksa7)
owns the delivery contract and unresolved policy decisions. This record does
not approve production activation or turn provisional defaults into owner decisions.

## Decision

Stripe Billing owns recurring payment collection. Hosted Checkout Sessions
collect payment details; Customer Portal manages payment methods and cancellation.
The participant app keeps no card data. The vendor adapter belongs to
`apps/web/src/features/billing`; there is no additional billing package.

Pin `stripe` 23.1.0 and API `2026-10-28.endive`. The SDK's
[versioned API declaration](https://github.com/stripe/stripe-node/blob/v23.1.0/src/apiVersion.ts)
matches the [current versioning documentation](https://docs.stripe.com/api/versioning)
read on 2026-11-04. Use the async webhook verifier on Bun, whose SDK export uses
Web Crypto. Verify the exact body bytes with an injected receipt time. Delivery
freshness is distinct from event creation time: a legitimate retry can report
an old event. Treat events only as bounded synchronization hints, never as
entitlement commands. Invalid payloads, mode mismatches and signatures fail closed.
SDK errors containing payloads or signatures never leave that boundary.

Configuration is either absent or complete. With no Stripe configuration,
billing stays inert and existing beta operation continues. A partial group
refuses startup with field names only. `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET` are registered secrets; `STRIPE_PREMIUM_PRICE_ID` and
`STRIPE_PORTAL_CONFIGURATION_ID` select server-owned vendor objects. The key's
test/live mode is part of the configured state. Configuration does not release
Checkout: FLAGS-15 separately owns the new-purchase release decision. Turning
off new purchases must not disable management, reconciliation or erasure.

The owner selected USD 10 per month, five bot debates per Stripe billing period,
unlimited casual AI judging, requested Round analysis, host casual capture and
authorized Recording downloads. Free human play and ranked AI judging remain
free. A free account gets one bot debate, one associated AI judge and one
requested analysis ever. Existing ballots keep their normal permissions.
Delivered analysis remains readable to its authorized debater after Premium
lapses; existing Recordings keep their visibility rules. Paid cancellation
normally retains access until period end.

Premium uses the existing grant and usage boundaries, with explicit plan mapping
for `round_analysis`, `ai_rounds`, `casual_ai_judge`, `casual_capture` and
`recording_download`. Every new entitlement kind requires a reviewed mapping.
No second usage ledger or provider-job lifecycle is introduced. Beta retirement
must remove every beta-sourced benefit without disabling paid grants.

## Recorded implementation defaults

The point guard's Delivery ruling `fekmvtormp4xa9qukvxac4mp` records
DEC-362–366 as defaults open to owner confirmation or overrule:

- The optional lifetime free judge binds to the exact free bot Round. Selecting
  both reserves them atomically; their provider outcomes remain independent.
- All analysis is requested, one report per own completed debater seat, with
  one outstanding request per account and feature-specific capacity. Actual
  authorized frozen evidence governs eligibility, including ranked retention
  and all relevant participants' privacy authority. Content purge preserves
  only justified minimal request/accounting identity; it cannot reopen generation.
- Verified failed renewal of previously paid access gets seven days from its
  previous verified paid-through boundary. No initial-payment grace, new bots
  or allowance fallback during grace. Active vendor status alone is not paid
  evidence. Every capability read uses the same injected-time validity check;
  worker outage cannot extend paid or grace access.
- Closure commits the local tombstone, revocation and durable vendor obligation
  atomically. Vendor cancellation then deletion can retry through outages.
  Late customer/session/subscription discovery enqueues cleanup. An in-flight
  charge needs durable refund follow-through and private operator escalation.
  This explicitly supersedes BILL-15's literal cancel-before-close wording via
  BILL-15-r1; that original criterion must never be reported as a literal PASS.
- Existing DEC-316 remains per-account lifetime identity, with no new digest.
- Contribution-margin alerts use a provisional 30% completed UTC-month floor;
  current month is an estimate, missing required measurements are unknown,
  and nonpositive revenue has no ratio. Production economics and controlled
  sandbox threshold proofs remain distinct.

Synchronization applies only with current generation, exact claim identity,
customer mapping and account authority. Duplicate receipts preserve pending
work without continuously invalidating a healthy claim. Reclaimed leases and
new hints invalidate older responses. No vendor I/O runs under account locks.

The allowance decision reads durable verified subscription evidence at its own
current instant; BillingAccess is only a result, never a stored observation-time
authority. Current normalized `past_due` plus the relevant verified renewal
failure is required for grace. Active status with a failed invoice alone keeps
only a previously verified paid interval. Bot and Room mutation adapters obtain
required locked facts before sampling database time immediately before the pure
capability decision. Room creation timestamps are separate from cast authority.

The existing platform-ending bot credit remains, per Delivery
`c4s8d9wjg9kn2c90s95bihx5`: only the existing qualifying `recovery_bound` or
finalized `capture_shortfall`/`platformLostTooMuch` paths authorize it. It may
restore counted bot allowance even after a served call, without rewriting the
provider outcome, measured cost or unknown exposure. Record its reason and
authoritative Round/incident provenance distinctly from provider definite
failure. Mixed reasons and retries can restore the original reservation only
once, against its immutable original source and period; no renewal carryover.
Judge/analysis usage and exact free-judge binding remain independent. Ordinary
forfeit, cancellation, silence or transcript incompleteness creates no credit.
This is allowance restoration, not a Stripe refund or renewed dispatch authority.

Historical restoration is an observed fact, distinct from authorization for a
new platform credit. The credited state's provenance also permits
`recorded_restoration`; the live `platform_credit` event still permits only
`recovery_bound` and `capture_shortfall`. Preserve the original refund instant
as `creditedAt`, original count/source/period and all provider evidence. Missing
or unknown executions never imply definite failure. Late evidence can resolve
an unknown aggregate without another restoration or renewed request identity.
A live Round's received call cannot finalize the aggregate of future calls.
The forward repair uses durable facts and restores the runtime immutability
trigger within the same exclusive migration transaction; repeat execution
preserves already-correct rows. Applied migration history remains immutable.

Historical casual judging gains a reservation only for a missing casual AI-judge
cohort with an unerased human frozen creator. Its source is the original beta
UTC month at Round creation, independent of current Room host or grants. Ranked
and human judging remain outside this cohort. Claim and lease creation are not
provider dispatch. A counted, definitively failed aggregate with no historical
restoration is `definite_failure`, distinct from `refunded`: no synthetic refund
time or relief event. It stays spent and terminal on repeated settlement,
refuses dispatch and abandonment, and cannot release free binding. Normal live
failure settlement from dispatched/unknown still records its one actual refund.
Every counted state carries an immutable `countBasis`: `dispatch_record` for
live first-call recording, `historical_observation` for recognizing prior
execution evidence. Earliest qualifying attempt timestamps are historical
recognition instants, not claims about exact vendor dispatch. A failed-attempt
row alone is insufficient without corroborating execution evidence. Preserve
the original frozen sponsor/admission and beta period even when recognition
crosses a month or follows Round terminalization; never substitute a claim,
lease or run-creation time, clamp timestamps or invent relief. Count chronology
is admission <= recognition <= database time. Export retains this meaning.

The one-off missing-judge backfill follows the existing beta migration's
namespaced derived identity convention: a truncated SHA-256 of its migration
namespace and frozen Round/sponsor identifiers. This is a migration-only
exception to application-minted cuid2 IDs, not a public lookup or bearer
capability. The existing unique sponsor/Round/kind key controls replay; no
runtime path derives IDs or recreates deleted usage. All live admissions
continue to receive injected cuid2 identifiers.

Only an existing qualifying bot platform credit may restore unrestored bot use;
its provider failure remains unchanged and judge usage never receives that credit.

DEC-367 remains pending owner confirmation (Delivery
`ehql83zprgmhdxx0mrw21r4j`). Only an abandoned Round's entire selected,
proven-undispatched bundle may release its matching original free-judge
binding, atomically under account and Round fences. The unselected optional
judge needs no reservation, but concurrent judge admission must be excluded.
A missing selected reservation, elapsed lease or absent response is not proof.
Any durable dispatch, unknown outcome, counted/refunded use or platform credit
on either side retains the binding. Released identities remain terminal;
replacement requires a fresh Round and admission. Source, period and provider
evidence remain unchanged. BILL-9-r1/11 and BILL-18 own the truth table and real
release/dispatch/judge-admission/replacement race and stale-worker proof.

The usage state and its pure event transition live in protocol, following the
existing Recording lifecycle boundary. The allowance and account authorization
decisions remain in auth. The transition receives current feature dispatch
deadlines on dispatch/expiry events; late accounting does not reconstruct a
past dispatch deadline from mutable current feature state. Database adapters
supply post-lock time and verified authority/evidence, persist the transition
once, and never change its original source or period.

## New-purchase admission and recovery

The accepted Flags contract is recorded in Delivery
`toqfjht5o6ezhvspgvbd084l` and `y6t63ad0nqflp2ma5ztbnn7g`.
`isReleaseEnabled` is display-only. A new purchase intent uses the injected
`releaseAdmission('premium-checkout')` pure synchronous policy and
`requireFlagAdmission(tx, accountId, policy)` in its own bounded transaction.
The lock order is command/idempotency gate, canonical account fence, shared
transaction Flags lock, then Flags rows. No shared-to-exclusive upgrade.
After locks, a separate READ COMMITTED statement samples bounded dependency
and account-override facts plus `clock_timestamp()`. Persist that admittedAt;
subsequent work is minimal. Lock waits and the whole transaction are bounded.
Database code never imports web feature code. No lock spans Stripe I/O.

A completed disable blocks later admissions. A matching already-admitted
attempt can recover through a separate authenticated operation while the
new-purchase route is dark, under current account authority. Recovery never
creates another intent or changes its account, product, price or vendor key.
The implementation bounds are five minutes for session creation and one hour
for the same Checkout Session from admittedAt, subject to vendor proof.
After the creation deadline, retrieve/reconcile only; after the checkout
deadline, expire/clean up. Unknown outcomes block replacement even beyond
vendor idempotency retention. A genuinely new attempt requires fresh admission.
Erasure overrides continuation and late discovery requires cleanup.

Flags core reaches main before Billing rebases and regenerates migrations.
Billing owns real FLAGS-8/15 route, mutation, recovery and native-form evidence;
core fixtures alone do not establish consumer acceptance.

## Outstanding proof

The BILL-18 matrix distinguishes deterministic adapter tests, real PostgreSQL
race/crash evidence and genuine Stripe test-mode lifecycle evidence. Unit
signature fixtures are not vendor lifecycle proof. BILL-H, live keys, production
deployment/data/identity, tax and legal/minors activation remain human-controlled.
