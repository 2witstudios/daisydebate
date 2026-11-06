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

Receipt consumption, customer/subscription reconciliation and retained refund
reads have separate current-service runtime/proof obligations. HTTP ingress
alone does not establish their completion. Genuine Stripe TEST delivery and
crash/missed-event lifecycle evidence remain separate from controlled SDK-signed
unit fixtures. All original Billing acceptance criteria and launch obligations
remain in the existing plan.
