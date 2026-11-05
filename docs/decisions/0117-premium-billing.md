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
