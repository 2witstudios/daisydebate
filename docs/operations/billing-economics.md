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
or consumption witness are excluded; default counters never establish a known
response. Received counters, definite refusal and possible execution are distinct.
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
