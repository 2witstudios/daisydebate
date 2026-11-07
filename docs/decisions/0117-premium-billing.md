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

Stored analysis reuse checks the debater's current account and completed frozen
seat independently of a generation entitlement. The read holds every frozen
participant's shared account fence, refuses an erased participant, and evaluates
the injected read policy before loading private report facts. A report read does
not reserve usage or start a provider call. Removing grants or disabling the
generation worker cannot hide a delivered report that remains authorized.

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
  Historical automatic claims remain possible exposure, not proven dispatch or
  consent: preserve original attempts/model/tokens/times and terminal reports or
  erasure identities without creating a lifetime debit or refund. Retire only
  in-flight authority to an unrequested seat; a later real request may use
  `max(0, 2 - original attempts)` new calls. The replacement bounds lease
  acquisitions separately at four and keeps claim distinct from dispatch.
  Clearing a database lease cannot stop an old process paused before I/O. The
  one-time greenfield cutover stops/drains old workers, verifies termination and
  prevents restart before migrating and starting requested workers. Already-sent
  vendor calls remain unknown unless observed; stopping never proves nonservice.
  Production cutover remains human-controlled. The owning
  [analysis architecture](../architecture/round-analysis.md) records the cohorts
  and required proof. Requested persistence and its forward migration are
  implemented; independent acceptance remains in the plan's evidence matrix.
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

Synchronization claims last 30 seconds, failed reads retry after five seconds,
and scheduled reconciliation targets five minutes. The Stripe reader makes at
most three API calls, each bounded to five seconds with SDK retries disabled;
durable work owns retries. It verifies the configured monthly USD10 price,
quantity, customer, mode and invoice-line subscription binding. The current
subscription's latest invoice and newest paid invoice supply payment facts.
The reconciler traverses durable customer identities in keyset pages of three
and linkable pending receipts in pages of 25. A failed identity does not pin the
cursor; the next cycle retries it. Discovery and application require a current
web instance before and after each bounded transaction, including account lock
waits. HTTP acknowledgement follows committed receipt persistence, while a lost
or uncertain reply asks Stripe to retry. Verification reads exact bytes under a
256 KiB cap and an injected body deadline; an uncooperative stream cancellation
cannot extend that deadline. Runtime scheduling, the public route and vendor
cleanup remain incomplete until the owning plan records their proof.
Only an attempted, unsettled `subscription_cycle` invoice matching the current
item period and adjacent to the prior paid period establishes renewal failure.
Trial invoices and active status alone create no paid period. Terminal canceled
or incomplete-expired vendor identities cannot reopen from stale reads, and
older/missing invoice observations cannot replace a newer verified payment.

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

Applied `20261107080513_fair_midnight` has the exact historical-accounting
ID exception recorded in ADR 0018: `m` plus 23 hexadecimal characters of
SHA-256 over UTF-8 `casual_judge_usage:<roundId>:<frozenSponsorActorId>`.
The fixed namespace and original frozen Round/sponsor inputs identify only
missing historical casual-judge reservations. The 92-bit result is predictable;
it is not cuid2, anonymization, authorization or a bearer capability. Existing
business-key IDs are preserved; reruns cannot recreate erased usage. The old
beta migration used MD5 and supplies precedent, not policy authority. Runtime
admission keeps injected cuid2; no actor provisioning or general SQL generator
exception is introduced. Populated proof covers distinct Round/sponsor inputs,
stable replay, existing IDs, frozen host attribution, erased-account exclusion
and preservation of original source/count/restoration facts.

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

The web service recovers abandoned reservations on startup and every 30 seconds
through its existing scheduler and bounded database control lane. Each tick
reads at most 25 Round identities with a stable cursor; failures do not starve
later identities and the next full cycle retries them. Discovery grants no
authority. Each mutation rereads current account, frozen sponsor, selected cast
and usage under the existing account/Round fences, with service liveness checked
before work and before commit. Losing authority during a lock wait rolls back
the entire release. Shutdown stops between identities and awaits in-flight work.
No provider or payment-vendor availability is needed to restore unused local
allowance; counted and unknown use retain their original lifecycle and binding.

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
The purchase lock order is canonical account fence, customer/current
subscription facts, existing purchase, then shared transaction Flags lock and
Flags rows. Account serialization and the unique pending-account index resolve
duplicate admission. No shared-to-exclusive upgrade.
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

The purchase protocol freezes the account, test/live mode, configured price,
existing customer (if any), return origin and admission instant. The origin
comes from server configuration, never form fields; freezing it also prevents
a deployment URL change from changing an idempotent retry's parameters.
The vendor key derives only from the injected purchase identity. Hosted
subscription Checkout uses one fixed-price item, quantity one, automatic tax
and the card payment-method filter. Session/subscription metadata carries the
purchase identity without account details. Recovery links that would create
another Session are disabled. No Session URL is persisted or logged.

| Purchase state | Evidence and permitted continuation                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admitted`     | No create claim exists. A current account can claim inside the original five minutes; closure or cutoff permits terminal abandonment.                          |
| `creating`     | The durable claim records possible vendor execution before I/O. Its lease is at most 30 seconds and cannot cross the creation cutoff.                          |
| `unknown`      | A missing or failed response proves no absence of side effects. Retry after five seconds retains the first possible execution and identical parameters.        |
| `open`         | A verified owned Session is retrieved for a fresh hosted URL; at its one-hour deadline it requires vendor expiration. Local time alone never makes it expired. |
| `complete`     | Verified customer/subscription identities require separate payment reconciliation. Completion itself grants no entitlement.                                    |
| `expired`      | Positive vendor evidence makes this Session terminal. An old open response cannot regress it. A new purchase still requires fresh admission.                   |
| `abandoned`    | Only a never-dispatched admission can reach this state; the old identity can neither dispatch nor accept a fabricated Session.                                 |

Create dispatch samples the injected clock again immediately before I/O and
requires the exact persisted claim and configured mode. A late verified result
can still supply cleanup facts after a lease or account closes. Closure never
converts uncertainty into absence: possible execution remains a cleanup
obligation until positively reconciled. The vendor boundary verifies the
purchase metadata, customer, mode, configured monthly USD10 price, quantity,
fixed expiry, creation interval, URLs and complete line-item list. Only an
owned `checkout.stripe.com` Session URL can be returned. Terminal identities
cannot change under reversed responses. A complete Session with unpaid status
still establishes no access.

The [version-matched Checkout creation reference](https://docs.stripe.com/api/checkout/sessions/create)
and [expiration reference](https://docs.stripe.com/api/checkout/sessions/expire)
were checked against Stripe23.1/API2026-10-28.endive on 2026-11-05. The one-hour
deadline remains within Stripe's 30-minute to 24-hour creation limits throughout
our five-minute window. Stripe's [idempotency contract](https://docs.stripe.com/api/idempotent_requests)
allows key removal after 24 hours; uncertainty therefore continues to block a
replacement after that interval. Pure policy and isolated CLI test-object proof
do not establish native route or vendor cleanup acceptance.

`billing_purchases` persists the frozen offer and semantic purchase state.
Database guards preserve admission and first possible execution, known vendor
identities, and terminal state; runtime SQL cannot rewrite them. The bounded
control transaction samples time after the account and purchase lock waits.
Verified completion commits the purchase and customer/subscription mapping
atomically, initializing unpaid synchronization rather than grants. Duplicates
and reversed open responses do not invalidate a healthy synchronization claim.

Discovery uses Stripe's [Session list contract](https://docs.stripe.com/api/checkout/sessions/list),
also checked at API2026-10-28.endive. One pass reads at most100 candidates inside
the original creation interval and at most one fully validated matching Session.
The unknown state persists cursor progress with compare-and-set semantics.
An empty page or finished scan never proves non-execution; unresolved attempts
continue to block replacement. Current member management survives participant
withdrawal, but a new creation claim still requires participant admission.
Local closure removes only undispatched/positively expired purchase records and
retains possible vendor effects as cleanup obligations. Export omits internal
claim IDs and scan cursors. Current-service discovery and fact application
recheck service authority after account waits; a worker never obtains a new
creation claim from discovery. Changed closed-account Session facts and a new
Stripe privacy-job ID commit together, retaining only a closed mapping and no
subscription/grant. Identical observations and discovery cursor progress do not
rotate the job. Newly received, verified events for a closed mapped customer
also enqueue cleanup; their minimal receipt identity deduplicates replays.
The privacy completion fence reports idle when late facts replaced its job.
Vendor cancellation/refund/deletion and native routes remain required
implementation work; these adapters do not activate purchases.

DEC365's pending-owner refund default distinguishes verified in-flight or
post-closure payment from positively settled pre-closure payment. Ambiguous
chronology stays owed with private escalation. Webhook arrival and Session
creation are not payment chronology. Stripe InvoicePayment payment-success timestamps retain their original second precision. A supported payment interval equal to or overlapping local closure remains ambiguous and owed; only a wholly later interval admits a new automatic refund. Stored boundary facts and existing refund identities remain readable for reconciliation, but cannot authorize a new create. The forward trigger constrains new admission/create without retrospectively rejecting retained facts. A refund's durable action/idempotency
identity belongs to its original owned charge and period, independent of
rotating cleanup-job IDs. Unknown replies never authorize a fresh refund key;
pending refunds and unknown purchases prevent cleanup completion and deletion
of needed evidence.

The [current Stripe refund contract](https://docs.stripe.com/refunds) permits a
successful refund to later fail, or for applicable methods to require action
again. Refund observations therefore require a fresh bounded claim; they do not
follow a sticky terminal-success order. A stale response cannot replace a newer
claim. The original action and minimal private charge/refund routing survive
ordinary customer deletion and earlier cleanup acknowledgement. Neither a
30-day interval nor silence proves irreversible settlement. Reconciliation and
late verified events can reopen the same obligation without a new refund key.
These records serve financial cleanup and original-period accounting only;
the production retention duration and legal erasure guarantees remain the
recorded owner/BILL-H caveat. No automatic time-based purge resolves an owed
or externally revisable financial obligation.

`billing_refund_actions` keeps one action per mode/original charge. A bounded
creation claim records possible execution before vendor I/O; retries use that
action's stable key only within its original five-minute creation interval.
Later uncertainty uses bounded discovery, never a new key. Known refunds are
retrieved again, including after success. Claim acquisition cannot alter observed
facts, and a consumed observation cannot predate its claim. Only changed refund
identity/status rotates the cleanup job; an identical fresh read does not.
The table's runtime role cannot delete or rewrite original amount, invoice,
subscription period, closure/payment chronology, first execution or refund ID.

Signed `refund.created`, `refund.updated` and `refund.failed` events provide
minimal routing hints, not settlement evidence. They resolve through the retained
owned action/charge/mode and its action marker or known refund ID, including when
Stripe supplies a null customer. The existing durable receipt and bounded sweep
reopen cleanup after ordinary customer mapping deletion without recreating
access. Subject export includes original financial facts but excludes execution
claims/cursors. Production vendor-cleanup composition and genuine refund journey
proof remain required before activation.

Stripe cleanup execution belongs to nullable, Stripe-only `privacy_jobs.billing_cleanup`,
not the customer mapping. Its pure state interleaves five bounded lanes: purchases,
subscriptions, invoices, refunds and indexed retained observations. Each preserves
its selected resource and page remainder, before deletion/acknowledgement. A new job ID
atomically clears only execution state; durable purchases, refund actions,
original keys and financial observations survive. Current service, canonical
closed-account fence, exact job/claim/work and post-lock database time fence each
commit. Durable progress consumes its claim, preserves failure attempts and
schedules fixed bounded due time. A failed current attempt preserves every
selected resource/cursor frame, increments one failure, uses ordinary bounded
backoff and yields deterministically to the next unfinished lane. This is neither
resolved service nor cursorless progress; an uncertain purchase cannot indefinitely
block cancellation, invoice/payment and refund work. Idle/stale replies change nothing. Invoice payment subpages retain their
own cursor and cannot skip the remaining selected invoices.

Observed predecessor invoice IDs whose positive mode/customer routing is not yet
durable are retained explicitly as `invoiceDebt` in the Stripe job. They are
obligations, not execution authority: conversion and rotation preserve the exact
selected ID and remainder before retiring old claims/passes/cursors. An absent or
ambiguous route cannot discard an ID, acknowledge cleanup, or block a newly
arrived fact/job from committing. The bounded predecessor input is not an eviction
cap on retained obligations. Exact positive owned witnesses are materialized
using the existing injected runtime ID resource before identity debt is retired;
no SQL ID generator, guessed routing or refund eligibility is introduced.
Current routing alone is insufficient: the producer must positively read the
exact invoice under that owned route before its witness can retire identity debt.
Unknown identity attempts alternate with retained observation work and yield
across the existing lanes; exhausted discovery restarts its heads without relief.
Subject export includes these minimal identities, excluding execution claims.

A missing customer mapping never proves completion. Positive current absence of
mapping, possibly executed purchases and retained financial effects permits the
separate `no-vendor-effects` acknowledgement. Verified vendor deletion follows
completed scans and verified cancellation. Frozen offer recovery reads the
original purchase mode/price/subscription, even without a mapping; runtime
configuration selects transport only. Missing historical ownership stays owed.
The Stripe delivery branch must own progress/completion before generic
`Promise<void>` erasure dispatch; other vendors keep their existing contract.
Independent refund reads continue after mapping deletion or job acknowledgement.
Acknowledged-job discovery freezes the existing primary-key maximum at each new
traversal and carries an execution-only `(afterId, throughId)` continuation.
Each page still reads at most33 rows and classifies at most32; later higher IDs
cannot extend the pass. Exhaustion (including deletion of its last key) starts a
fresh head traversal. Per-row failures do not pin the page, page-read failures
retain the same continuation, and process restart safely begins at head. This
cursor grants no financial or account authority: reopening still takes the
canonical account/current-job fences and samples current database time. Original
financial facts, action keys and independently owed effects remain untouched.

The typed state and DB guards are implementation checkpoints; bounded vendor
composition and full lifecycle proof remain unfinished.

Within one invoice lane, an ambiguous payment must not block later invoices.
A capped deferred list or a single bookmark cannot preserve arbitrary exact
unknowns without a lossless reconstruction guarantee. The required Billing-owned
pre-refund observations therefore have their own minimal durable home, separate
from both execution and money authority. Each actual owned invoice/payment has
immutable owner/mode/customer/vendor identity and frozen source bindings; an
invoice-only enumeration witness represents payment identities not yet known.
Unknown allocation, charge, period or chronology remains explicit, never a
fabricated refund. Only affirmative classification resolves an observation, or
verified eligible facts link it to the existing unique original-charge action.

Persisting an observation and advancing its current claimed cursor are one
transaction. Existing privacy jobs remain the sole execution/claim host. Bounded
indexed discovery alternates with owed-record revisits, retaining every exact
unknown without capped eviction. Exhaustion, disappearance, job rotation and
customer deletion cannot clear owed observations. Completion checks their current
obligations and linked money actions; shared charges never gain multiple refund
keys. Retaining or reusing unchanged owed facts while atomically consuming the
exact selected remainder is genuine fixed-due progress. An unresolved read/action
without that durable retention and cursor transition remains failure/backoff;
replay is idle without accounting or due mutation. An exhausted pass with current
owed observations restarts all traversal heads fairly, preserving every observation
and original action. Missing current obligation facts cannot admit deletion.

The prior four-to-five-lane forward execution transition runs under one transaction:
an exact temporary transformation guard, the data update, then the final strict
guard. Pending NULL execution gets five head pages; old scanning frames retain
their original selections, remainders and cursors while adding observations.
Old deletion demotes to real discovery. Claims retire without declaring possible
vendor effects resolved or never dispatched. Job IDs, queue times, attempts and
financial records remain unchanged; historical typed acknowledgements and succeeded
NULL execution remain historical facts without an invented outcome. Old replies
cannot consume the new execution. There is no trigger disable or runtime
compatibility parser. This is the same BILL15r1 scope and pending-owner policy.
Observation storage, exact-source export, retention and traversal guards have
focused implementation proof; payment classification, new-fact atomic rearming
and full runtime delivery remain implementation work.

Retained observation routing, including classified pre-closure facts, defeats a
no-vendor-effects acknowledgement. Verified customer deletion is a different
outcome: every owed invoice/payment and every linked original action without
current known success still blocks acknowledgement. The application reads that
explicit obligation fact after canonical account/job waits and samples fresh DB
time before admission. SQL enforces the same completion boundary. A later refund
reversal atomically rotates/reopens the job while preserving the original action;
the unfinished observation writer must likewise pair new facts with rearming.

Exact positively retrieved paid InvoicePayment chronology has its own typed
evidence branch. With original mode/customer/invoice/payment and frozen offer
ownership corroborated, the whole paid timestamp second must end at or before
local closure, using fresh post-lock database time and rejecting future evidence.
This can classify only that payment as pre-closure while charge, allocation and
period remain unknown. Conflicts remain owed. It never resolves invoice
enumeration, other payments or a bound refund action, and creates no money
authority. New refunds still require the complete original-charge/allocation
proof and the sole original action/key. Observation rows retain this distinction;
privacy jobs alone own cursor/claim execution.

Invoice enumeration requires a current execution pass, independent of payment
classification or refund settlement. Active cleanup execution uses literal
version 3; historical acknowledgements retain their original shape. A new pass
retires prior enumeration coverage to an owed invoice witness while preserving
original source, payment evidence, action links and sticky conflicts. Its bounded
comparison stores the complete normalized ordered reads up to 20 members. Beyond
that, an explicit comparison overflow retains the prefix and count while discovery
continues retaining every obligation; it cannot authorize completion or eviction.

Fresh coverage requires one unfiltered exact-invoice HEAD response with fixed
limit 20, nonzero complete ordered membership/evidence and `has_more=false`,
matching the entire retained pass progression. A subsequent fresh owned invoice
read must preserve the frozen offer and period. A tuple, historical row count,
old resolved witness or matching multipage traversals supplies no snapshot
guarantee. Multipage continuity remains unresolved and owed until supported
producer provenance exists; the bounded path does not silently complete it.

The final transaction holds canonical account and current job authority, retains
each returned decision before cursor advancement, and compares only the at-most-20
receipt members plus indexed current obligation/action checks. Freshness belongs
to the pass/job/claim-bound producer receipt; unchanged retained observations keep
their recognition time. PostgreSQL guards persist and validate current execution,
the complete HEAD receipt, exact membership/source/link bindings and post-wait
claim validity. The actual subsequent vendor invoice read and its receipt timing
remain application producer assertions, validated before resolving the witness
and consuming its pass in the same transaction. SQL does not independently attest
that vendor I/O occurred. Resolving enumeration never settles its payments or
actions; independent owed facts continue to block acknowledgement through F3.

Applied112 first introduced v2 passes while preserving predecessor-complete
heads. Those heads do not prove current membership: consuming a remaining refund
head could otherwise enter deletion using historical enumeration. The forward
v3 correction uses an exact temporary guard, deterministic data update and final
strict guards in one transaction. Only pending v2/null execution changes.
Canonical account, job and invoice-observation locks precede its database time.
It retires claims and pass receipts, preserves every selected ID/remainder,
identity debt and original queue accounting, and resets nonselected invoice and
observation frames to HEAD. Old deletion/null demotes to real discovery.
Enumeration-resolved invoice witnesses of these pending subjects become owed;
original owner/source/creation facts and all payment/action evidence remain.
Sticky conflicts, historical ACKs and non-Stripe jobs are untouched. Indexed owed
facts prevent selected tails from bypassing newly rearmed earlier invoices;
exhausted owed passes revisit all heads. Strict version3 rejects old-worker
claims, and replay does not reset new version3 authority. No runtime compatibility
parser accepts retired execution. This forward correction requires populated112
and runtime-role proof before delivery acceptance; it is not supplied by the
older112 preservation tests or by producer assertions alone.
The pinned [Stripe23.1 InvoicePayment contract](https://github.com/stripe/stripe-node/blob/v23.1.0/src/resources/InvoicePayments.ts)
identifies the success timestamp separately from invoice allocation; the
[object reference](https://docs.stripe.com/api/invoice-payment/object) permits
partial allocation. Neither observation supplies whole-charge refund authority.

Flags core reaches main before Billing rebases and regenerates migrations.
Billing owns real FLAGS-8/15 route, mutation, recovery and native-form evidence;
core fixtures alone do not establish consumer acceptance.

## Outstanding proof

The BILL-18 matrix distinguishes deterministic adapter tests, real PostgreSQL
race/crash evidence and genuine Stripe test-mode lifecycle evidence. Unit
signature fixtures are not vendor lifecycle proof. BILL-H, live keys, production
deployment/data/identity, tax and legal/minors activation remain human-controlled.

Canonical main99 note: this preserves the exact historical-accounting namespace,
inputs and first23 SHA256 hex digits originally reviewed in private
`20261105051949_casual_judge_usage`; it grants no new runtime ID generator or
application-provisioning backfill. The new main predecessor requires its own
populated transition proof; original private-tail receipts remain historical.
