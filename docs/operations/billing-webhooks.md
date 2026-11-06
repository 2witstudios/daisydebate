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
