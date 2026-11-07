# Private Billing economics

BILL-17/BILL-17-r1 reports original-source economics; it never grants access,
changes allowance or creates payment/refund authority. ADR0117's provisional
floor is 30% contribution margin for a completed UTC calendar month. The open
month and inputs priced from catalog estimates remain estimates; missing
measurements remain unknown. Nonpositive net revenue has no ratio.

The current-service `createBillingEconomicsReader` uses the existing bounded
control transaction. One READ COMMITTED statement reads actual provider run
and requested/historical analysis facts alongside original allowance source,
period, state and count basis. Aggregate output contains no user, actor, Round,
customer, charge, request token or report content. Parent claims with no dispatch
or consumption witness are excluded; default token counters never establish
measured-zero cost. Received response, token-counter knowledge, definite refusal
and possible execution are distinct.
Allowance refunds/platform credits cannot remove provider expense. Historical
analysis with missing original source stays unattributed; a later request's source
must not be substituted. Original source periods survive alongside reporting-month
attribution. These are private operational aggregates, not an anonymity claim.

At most 1000 daily/model/source groups per collection are complete. A 1001st
group, invalid data, stale service or failed collection refuses completeness.
No truncated sample is a measured month. Rates bind the recorded provider/model
and actual first-through-last call instants; a price change or overlapping price
inside an aggregate requires finer measured input and otherwise remains unknown.
Token pricing uses integer USD micro-units and rounds a bucket's fractional micro
up once. Shared cost allocations total 10000 basis points and conserve signed
micro-units using largest remainders, then input share order for ties.

The private financial feed is explicit and validated. Each measurement identifies
its original UTC source month and observation time. Monetary refunds subtract from
that original month's revenue, including late observations; a usage restoration
is not a monetary refund. Expense credits remain signed. Models, speech, recording,
broadcast, storage, payment fees, residual shared expense and free-tier subsidy
need separate coverage receipts. A coverage receipt asserts a reconciled complete
category, including a positively measured zero; an absent category is unknown.
Normalized source lines must be disjoint: do not include the same supplier expense
again as shared residual or subsidy. A free-tier expense allocation moves that
expense to its funding plan under `free_subsidy`; it does not add a second invoice.
The private feed's `modelCostBasis` chooses complete provider invoice costs or
usage-counter/rate pricing. The latter refuses direct model-cost lines to prevent
double counting. Invoice accounting and unresolved provider outcomes remain
separate observable facts. No rates or invoices are seeded as production truth.

`createBillingEconomicsCollector` joins that feed to the actual bounded snapshot,
saves the private report, then uses the existing ErrorReporter. The fixed codes
are `BILLING_LOW_MARGIN` and `BILLING_ECONOMICS_INCOMPLETE`; routes identify only
free/beta/premium and the correlation value is a UTC month. No financial amounts,
model usage or personal dimensions enter the alert. Delivery failure returns a
failure and attempts the fixed completeness signal; there is no console fallback.
The existing Sentry adapter and scrubber own transport. Production alert-rule,
credentials and destination provisioning remain human-controlled. Local injected
transport tests are not evidence that a production alert reached an operator.

`createBillingEconomicsFiles` is a concrete private filesystem edge, with no HTTP
or participant route. Its injected directory must be mode0700. A normalized feed
is `feed-YYYY-MM.json`, a regular, nonsymlink mode0600 file of at most1MiB; absence
returns unknown input. Reports use an injected cuid2 filename, mode0600 and exclusive
creation, so an existing report cannot be silently overwritten. Report data stays
in this private sink; it must never be served from a public directory or copied to
telemetry. Service composition, directory provisioning and lifecycle/retention are
owned by the integrating Billing runtime, with the existing compliance policy.
Unlimited-feature volume and capacity are separate report fields. One active Room
is concurrency authority only and never a monthly cost ceiling; absent capacity
measurements are unknown rather than inferred from configuration.

Current limitation: no actual measured infrastructure invoice/rate feed has been
established for this assignment. Its absence must emit completeness and cannot
establish a real measured-margin acceptance result. Integration adoption, actual
source/role PostgreSQL proof and controlled threshold transport receipts must be
recorded separately in the existing Billing plan. This document does not mark any
criterion complete or supersede BILL-H.

The concrete file edge uses the existing operational-data maximum30-day period
(DEC-42), not a new financial-record retention policy. On each read/save it visits
at most1000 directory entries and removes only expired regular files in its own
closed feed/report filename namespace. At1000 retained files a new save refuses;
more than1000 entries also refuses, rather than claiming a drained sweep. This
bounds this sink's generated files and cleanup work. Provision the directory only
for this sink. Source financial systems retain their own classified records; the
feed file is a temporary normalized operational projection. No deletion here
resolves an owed vendor obligation, alters original accounting or revokes access.

The private feed binds `startsAt`/`endsAt` to the requested calendar month. Its
optional `volume` array may supply measured capacity for each feature and measured
capture/download volume; absence is null/unknown. Model-feature volume continues
to come from actual ledger/attempt cohorts, so supplied capacity cannot overwrite
it. Ledger completions describe reservations admitted in this month, while call
volume describes executions observed in this month; the retained original source
period is separate. A credited allowance with a delivered provider outcome still
counts as delivered volume. No current configured concurrency value is accepted
as an observed high-water measurement.

A `reported` collector result means the report was saved and signals submitted to
the existing reporter port. `alertDelivery` remains explicitly `unconfirmed`:
the void ErrorReporter cannot acknowledge operator delivery and may be inert
without keys. Only a separately retained approved private transport/destination
receipt can establish that an operator received the named alert.

## Response outcome and token-counter knowledge

The OpenRouter adapter permits an absent usage object and stores its missing
prompt/completion pair as0/0. A received/answered marker proves a response; it
cannot distinguish that default pair from genuinely reported zeros. The reader
therefore retains `knownResponses`, provider outcomes, original sources and token
totals, and separately counts per-response zero pairs as `unmeasuredResponses`.
That count is a subset of received responses, not another unknown provider outcome.
It is computed before aggregation: a positive row must not hide an unmeasured
response in the same model/day/source bucket. A positive counter witnesses the
paired usage object under the current adapter contract, whose two counters are
required together, so its other zero counterpart is retained normally.

The strict snapshot requires this knowledge field and rejects contradictory
counts. Usage-counter pricing preserves known positive totals but keeps the whole
bucket unknown when any received token pair remains unmeasured. Separate unknown
provider calls remain unknown calls. A complete independently reconciled provider
invoice basis can establish money cost without claiming token counters became
known. No historical usage-presence marker or provider-job/schema rewrite is
introduced; genuinely measured0/0 cannot be established from current stored facts
alone. The old received-zero PostgreSQL fixture proves its response outcome only;
its earlier interpretation as measured-zero provenance is explicitly superseded.

## Source availability and operator handoff

Qualification baseline: Billing `6a56ee944fda4490548d9ac4603634901b0e6b33`.
The following is an availability assessment, not a supplier reconciliation. The
local assignment has no configured `BILLING_ECONOMICS_DIRECTORY` or `SENTRY_DSN`;
no private financial export or approved destination was supplied. No credentials
or vendor financial records were requested, printed or sent. Existing test-mode
payment proofs cannot establish production revenue or supplier cost.

| Input                | Existing read/measurement seam                                                                                               | Available knowledge and missing reconciliation                                                                                                                                                | Required dates/allocation                                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Revenue              | Stripe payment observations and subscription/payment adapters; `billing_payment_observations` retains positively owned facts | Observations are recovery evidence, not a complete accounting export. No normalized paid-receipts export is supplied. Subscription status/price is not collected cash.                        | Original recognized UTC month, observation instant, actual USD receipts; allocate Premium only for positively identified plan. Exclude tax/liabilities according to the retained source reconciliation.                                           |
| Monetary refunds     | Original `billing_refund_actions` plus retained payment observations                                                         | An action/request/allowance restoration is not a successful cash refund. No reconciled successful-refund export supplied.                                                                     | Bind the refund to its original revenue month; late observation must not move the expense into the current month's revenue. Keep source reconciliation privately outside this feed.                                                               |
| Model usage          | `createBillingEconomicsReader` over actual agent runs, requested/historical analysis and original usage ledger               | Genuine current-service SQL proof exists. Outcomes, positive paired counters, unmeasured zero pairs and unknown attempts remain distinct. Historical missing provenance remains unattributed. | Actual recorded provider/model and first/last call instants; original allowance source/period; no current configured model substitution.                                                                                                          |
| Model rates/invoices | Private `rates` or `modelCostBasis=provider_invoice` contract                                                                | No billed rate schedule or reconciled OpenRouter invoice supplied. Repository/model configuration and design estimates are not billed rates.                                                  | Exact provider/model, effective interval covering every priced call, observed instant, USD micros/million. Catalog prices must be `catalog_estimate`. Invoice basis requires complete disjoint `models` cost lines, not additional token pricing. |
| Speech/media         | Agent speech characters and media/capture operational facts                                                                  | Characters/recording existence are not billed duration, transcription completeness, egress or a supplier invoice. No reconciled speech/recording/broadcast export supplied.                   | Service period and observed instant; separate `speech`, `recording`, `broadcast` costs. Allocate from measured usage or retain allocation unknown.                                                                                                |
| Storage              | Recording/object lifecycle and storage operations                                                                            | Object existence and forever-retention policy cannot establish byte-hours, replicas, egress, invoice or measured zero. No storage billing export supplied.                                    | Original UTC month, actual billed storage/egress and observed instant; disjoint `storage` allocation. Never infer cost from absent rows.                                                                                                          |
| Payment fees         | Stripe financial/balance reconciliation, external to recovery facts                                                          | No fee export supplied. The design's percentage/flat fee remains an estimate, never measured fee.                                                                                             | Actual fee/credit USD micros, original month; do not subtract it both from revenue and `paymentFees`.                                                                                                                                             |
| Shared expense       | Supplier/platform financial exports                                                                                          | No host/database/Redis/network invoice or allocation supplied. Repository code metrics and process-health counters are not financial measurements.                                            | Original month and observation instant; residual only after direct categories, documented `usage_share`/`equal_share` totalling10000bp.                                                                                                           |
| Free subsidy         | Original source cohort in ledger plus allocation of the SAME supplier expense                                                | Free/beta/source volume exists; it does not prove who funded an expense or its dollar amount. No subsidy allocation supplied.                                                                 | `free_subsidy` reallocates an already reconciled expense to funding plans, never adds the same invoice a second time.                                                                                                                             |
| Volume               | Actual source reader's ledger completions/call attempts; private `volume` for capture/download                               | Model-feature source counts are available; capture/download complete counts are not exported by this collector and stay null. Unknown dispatch remains possible work.                         | Admission month and execution month remain distinct; credit does not erase delivered work.                                                                                                                                                        |
| Capacity             | Private per-plan/feature `volume.capacity` measurement                                                                       | No observed high-water/time-series export supplied. One active Room is a configured concurrency fence, not monthly usage, spend, or a measured peak.                                          | Actual observed peak and corresponding limit for this exact month; absent measurement stays `{kind:"unknown"}`.                                                                                                                                   |

No additional vendor ingestion adapter is justified by these available contracts:
there is no authorized raw export format to normalize or complete supplier source
to reconcile. The existing bounded private JSON edge is the ingestion adapter.
Guessing vendor columns, scraping credentials or treating recovery tables as a
complete invoice ledger would manufacture authority. A subsequent supplied export
must specify format/version, mode/currency, completeness boundary and allocation
before an adapter can truthfully mark its coverage measured.

### Minimal private input

For an October2026 collection, an operator can provide this exact **incomplete**
feed in a dedicated mode0700 directory as mode0600 `feed-2026-10.json`. It is a
reviewable template, not a measured-zero fixture:

```json
{
  "startsAt": "2026-10-01T00:00:00.000Z",
  "endsAt": "2026-11-01T00:00:00.000Z",
  "floorBasisPoints": 3000,
  "modelCostBasis": "usage_counters",
  "revenue": [],
  "costs": [],
  "rates": [],
  "coverage": [],
  "revenueCoverage": [],
  "volume": []
}
```

For each available source, replace only supported fields using the strict
`economics-input.ts`/collector feed schema. Supply distinct nonnegative sequences,
original source month and observation instant. Money is signed integer USD micros;
a refund uses `kind:"refund"` with a nonnegative amount. Cost allocation shares
sum to10000bp. Explicit unknown money has `kind:"unknown"` and a closed reason
(`not_measured`, `rate_missing`, `allocation_missing`, `outcome_unknown`). Do not
add arbitrary vendor IDs, personal data, provenance text or modelUsage fields to
this strict normalized feed. Retain source exports, hashes, reconciliation and
allocation rationale in the authorized private financial evidence location.
Coverage is a separate complete-category assertion, including a positively
reconciled zero; never populate coverage merely because arrays are empty. Unknown
sources can stay absent and the report must remain incomplete.

The operator's minimal missing input package is: exact month; mode/currency and
reconciled receipts/refunds/fees; dated supplier model rates OR model invoices;
speech/media/storage/shared expense and disjoint allocation; complete-category
receipts; and independently measured capacity/capture/download counts if known.
Partial delivery is useful: leave remaining categories unknown. No live purchase
or production configuration change is required to prepare this package.

### Reviewable collection and destination receipt

Use the existing approved local service checkout/slot and its normal environment;
do not copy production credentials into a test checkout. After provisioning the
private feed directory and a current local service instance, the existing runtime
invocation is:

```sh
BILLING_ECONOMICS_DIRECTORY=/absolute/private/economics bun run start
```

This is the normal web process, not a new finance CLI: it requires that checkout's
already qualified runtime build and local service configuration. It starts one
current-service collection of the previous completed UTC month, then hourly;
it also starts the other registered workers. Review that process's existing local
TEST-mode worker configuration before invocation. Do not launch a second process
against an active instance or use this example to activate production. The current
assignment has not executed that full process command. For a one-off/late-month
correction the existing `composeBillingEconomics(app, instanceId).run(window)`
seam is available to the integrating process owner, retaining the same bounded
current-service reader and private sink; there is no participant/admin endpoint.

Record the exact candidate/source hashes, month, feed hash, report hash and private
file mode, plus the actual current-service query receipt. Missing feed must submit
`BILLING_ECONOMICS_INCOMPLETE`; a separately labelled controlled threshold crossing
can qualify signal plumbing but cannot establish a real measured margin. Existing
`reporterFrom` maps only fixed signal/errorCode, plan route and UTC month to Sentry.
The collector's `alertDelivery` remains `unconfirmed` even when capture returns.

No approved local external operator destination/DSN was supplied. No outbound
operator message has been sent. The remaining minimal human-controlled delivery
step is to select an already authorized private destination, perform an approved
completeness canary through that same reporter, and retain a destination-side
receipt showing signal code/month/environment/arrival instant and event reference.
A scrubbed SDK capture, HTTP acceptance or event ID alone does not prove operator
notification. Keep destination capabilities/URLs private. The economics report's
financial details must not be attached. Actual measured-margin and actual operator
receipt acceptance remain separate open requirements; neither is BILL-H activation.
