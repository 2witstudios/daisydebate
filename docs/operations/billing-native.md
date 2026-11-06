# Native Billing journeys

The Billing plan and ADR 0117 own the policy and activation decisions. The
native routes compose the existing purchase and allowance authorities; they
never grant access from a browser return parameter.

`composeNativeBilling(app, stripe)` accepts the integration root's Stripe
instance. It does not construct a second client. The root injects its lazy
result through `AppDependencies.billingNative`; the process must supply this
for both ordinary startup and an already adopted browser-fixture App. Missing
transport refuses rather than returning a successful vendor response.

- `POST /api/billing/checkout` accepts an empty native URL-encoded form only.
  Same-origin, authenticated identity and member budget precede durable
  admission. Price, quantity, customer, return origin and purchase identity are
  server-owned. Existing pending work recovers the same purchase. Unknown
  vendor results retain possible execution; they do not create a new customer
  or subscription. A validated open URL is exposed only after recording and
  re-reading the current owned session.
- `POST /api/billing/portal` uses the current account-fenced retained customer,
  configured mode and Portal configuration. A second ownership read after
  bounded vendor I/O prevents disclosing a session after closure wins. Portal
  operations do not read the new-purchase release flag.
- `GET /api/billing/settings` returns only the current member's projection.
  Bot debates remaining come from the existing locked allowance quote and its
  exact source/period. Reserved and unknown use count under the ledger's
  existing rules; unavailable reads never invent a zero or free reset.
- `/settings/billing` renders ordinary POST forms without client JavaScript.
  Return query values are fixed notices only. The display Flag reader is new
  for each settings call; the durable purchase transaction independently
  obtains current Flags authority. Killing purchases does not disable Portal,
  reconciliation or erasure.

The configured hosted Checkout Session collects payment in Stripe. Portal
configuration and actual period-end cancellation must be qualified in test
mode before activation. Current paid/grace access is read from verified
subscription evidence using the existing policy, never from a successful
return URL or an active vendor label alone.

## Evidence boundaries

The production process uses `createBillingApp` to lazily compose its native
operations with the pinned Stripe23.1/API2026-10-28.endive resource. Requests
have a five-second timeout and no automatic SDK retries; durable purchase
identity owns retries. Without Stripe configuration the resource is absent
and Checkout/Portal refuse while existing local allowance remains available.
An adopted test app can use the same factory with its explicit transport or
provide the existing native-runtime injection. This process binding does not
establish background reconciliation, vendor cleanup or genuine hosted payment
qualification; those have separate runtime and proof obligations.

The native companion's port, boundary and server-render tests prove source
behavior only. The isolated PostgreSQL member fixture proves canonical account
fences, lifetime usage, completed-Session routing without paid grants and an
explicit `daisy_web` execution. Those fixtures use controlled observations,
not a claim of genuine Stripe payment or a browser journey.

Retain genuine test-mode Checkout/Portal lifecycle and actual production-server
browser proof separately with source hashes, commands, complete counts and
artifacts. Required scenarios include JS-off purchase, double submission and
lost response, foreign fields/origin, stale return claims, current release
kill, cancellation/management while purchases are dark, and correct usage.
Missing vendor configuration or resource admission is a named proof gap, never
a skipped or fake successful vendor flow. BILL-H/live identity, secrets,
production activation and the recorded minors/legal decisions remain human.
