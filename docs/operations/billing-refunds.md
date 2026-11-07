# Retained refund reconciliation

The web process runs one single-flight original-action sweep every five seconds
when Stripe is configured. It reads at most three action identities per tick
through the current-service database facade, advances its indexed keyset past
failed identities and restarts from the head after exhaustion. The sweep does
not depend on a customer mapping, pending privacy job or the new-purchase flag.
A previous successful refund remains eligible for bounded vendor reads: elapsed
time and customer deletion do not establish irreversible financial finality.

The action's original mode, charge, allocation, period and immutable action key
remain the only money authority. The configured purchase price is not used.
The pinned Stripe adapter performs bounded creation, discovery or retrieval as
admitted by the current exact action claim. Unknown execution retains the same
key; it cannot be escaped by rotating a privacy job or creating another action.
A known refund is retrieved by its original identity, including late failed or
requires-action observations. Mode mismatch refuses before transport.

Vendor I/O occurs outside database locks. Recording reacquires current service,
canonical account and exact action-claim authority; changed financial facts
atomically reopen cleanup with a new privacy-job ID. Identical facts preserve
the healthy job. Drain stops further discovery but waits for the in-flight
financial response and its fenced accounting rather than dropping the result.

`billing.refund.failed` exposes only fixed stage/error codes through the existing
scrubbed reporter and structured logger. Customer, charge, action identifiers,
amounts, raw responses and SDK exceptions are not log fields. An absent Sentry
configuration remains inert; this source is not evidence of operator delivery.

Controlled scheduler/SDK tests are separate from genuine Stripe TEST lifecycle
proof. Production activation, keys, deployment and legal retention duration
remain the existing human-controlled BILL-H obligations. This worker does not
complete the separate five-lane customer cleanup or invoice-coverage proof.

Invoice discovery retains each exact owned invoice witness before admitting its
page or selected remainder. A predecessor may have observed an invoice identity
before retaining its routing. The Stripe job preserves that identity as explicit
unrouted invoice debt across migration and job-ID rotation, alongside retired
execution authority. Missing or ambiguous routing stays owed; no customer, mode,
offer, charge or refund is invented. Both completion outcomes refuse this debt.
Its exact identities are included in the subject export without worker claims,
passes or vendor credentials. Actual owned routing is retained before removing an
identity from this debt, and independently owed payments/actions remain intact.
An available customer route supplies a place to read; it does not by itself prove
that an invoice belongs to that customer. Materialization also requires the
producer's positive exact owned invoice read, revalidated against the current
route and exact identity claim after locks. An absent or foreign invoice read
cannot manufacture routing or retire debt.

Unknown identity attempts yield to retained observations and the other discovery
lanes. Exhausted passes restart fair head traversal while retaining all debts;
there is no capped eviction or list-absence relief. The existing legal duration
and production activation decisions remain human BILL-H obligations. This source
contract does not itself establish completed vendor cleanup qualification.
