# Billing webhook ingress

`POST /api/webhooks/stripe` binds the existing signature-verification and
durable-receipt operation. The body is read without JSON reserialization,
with a256KiB limit and a five-second deadline combined with request cancellation.
Stripe signatures must identify one delivery timestamp within five minutes
of the injected receipt time. Verified event mode must match configured mode.
No browser session, release flag or return-page parameter grants authority.

With all Stripe configuration absent the endpoint returns404 and beta access
continues. A partial configuration refuses application configuration rather
than silently disabling existing management. Endpoint registration, signing
secrets and live activation remain BILL-H human operations; this source does
not create or modify a Stripe endpoint.

A204 means a verified routing hint was persisted or the verified event type
was irrelevant. It never means paid access was granted. Supported subscription,
invoice, Checkout and customer-deletion hints route to customer synchronization;
refund-created/updated/failed hints retain original-charge/action routing.
Duplicates use the existing durable receipt identity. Unmapped receipts remain
available for later ownership discovery. Raw event bodies and signatures are
not persisted or logged.

A failed durable write returns503 with Retry-After5. The process emits only
`billing.webhook.failed` and a fixed infrastructure failure through the existing
scrubbed ErrorReporter. Logger and reporter failures cannot turn a missing
receipt into acknowledgment or replace the retry response. No raw database or
vendor exception enters those signals. An unconfigured Sentry adapter remains
inert; source submission is not proof of operator delivery.

The process starts single-flight subscription repair every five seconds when
Stripe is configured. Receipt and customer keyset pages remain bounded; failed
identities stay durable while later identities can advance. Each current-service
claim carries the original completed purchase price, rechecked under the canonical
account fence at apply. Replacement new-purchase configuration cannot rewrite it.
Missing or ambiguous original offer evidence refuses repair; local grant validity
still expires during outages. Drain retires read admission and waits for the bounded
in-flight request without applying its result.

Retained refund reads, purchase recovery and vendor cleanup have separate runtime
and proof obligations. HTTP ingress and scheduled subscription source binding
alone do not establish their completion. Genuine Stripe TEST delivery and
crash/missed-event lifecycle evidence remain separate from controlled SDK-signed
unit fixtures. All original Billing acceptance criteria and launch obligations
remain in the existing plan.

## Subscription observation freshness

The existing subscription worker records private `billing.subscription.staleness`
aggregates against a fifteen-minute successful-observation target, independently
of its five-second tick and five-minute subscription polling policy. This signal
never grants access, changes the purchase flag, or treats a successful tick as
subscription evidence. The current web-service fence and database clock own each
read; no vendor call participates in its bounded transaction.

Each tick reads at most 33 open customer rows plus one continuation sentinel,
using the existing closed/customer keyset before selecting the configured mode.
Closed customers and erased accounts are excluded. The current subscription is
joined through its owning customer's user; a missing current subscription stays
unconfirmed. A settled customer with a matching current-subscription observation
proves application. For pending/claimed work only an observation strictly later
than that subscription's creation proves a prior applied read. Mapping initializes
both timestamps, so equal, missing, future or inconsistent facts are unconfirmed;
this does not assert they were never historically observed.

`oldestRevisionRequestAgeMs` measures the oldest CURRENT REVISION request among
observed pending/claimed customers. A new receipt replaces `requestedAt`, so this
is not continuous unresolved backlog age. Repeated hints cannot hide a stale
proven observation or turn an unconfirmed cohort healthy. Pending and claimed
counts are separate; neither is a successful-observation timestamp.

A cycle fixes a private local-ID upper bound and accumulates original timestamps,
re-aged at the final database time. Its first page observation and latest page
observation are exposed as `scanStartedAtMs` and `sampledAtMs`, with duration and
page count. These describe a mixed-time observed traversal, not an atomic fleet
snapshot. The fresh-coverage budget is twelve pages or sixty seconds; one page
runs per ordinary worker tick. Exhaustion inside that budget can be within target
only if all observed in-scope customers have proven fresh data. Over-budget or
unfinished traversal remains partial but retains its constant-space cursor and
oldest timestamps until actual exhaustion, so a stale tail is still observed.
Only exhaustion (or a failed/invalid read) restarts at the head; larger cohorts
cannot acquire a whole-cohort healthy claim from this bounded collector.
New insertions behind the cursor and concurrent changes belong to later cycles.
An overdue observation or revision request already found is a stale lower bound
even during partial coverage. Empty, disabled, unavailable and unconfirmed results
remain distinct from within-target coverage. A failed read discards the cycle.

Only counts, ages, coverage and fixed status names enter the existing logger.
No cursor, customer, user, subscription, vendor identity or payload is emitted.
Transitions into stale/unavailable also use the existing scrubbed worker failure
reporter; logging/reporting failure cannot stop reconciliation. These are private
operational signals, not a participant-facing availability guarantee.
