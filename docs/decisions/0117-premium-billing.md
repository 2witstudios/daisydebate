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

## Outstanding policy and proof

The exact free-judge binding, subscriber analysis details, renewal failure,
recoverable closure, cross-account anti-abuse identity and margin floor await
the recorded point-guard/owner process in the plan. Original leaf criteria and
the readiness-review remediation remain intact. In particular, local erasure
surviving a vendor outage and cancellation completing before local closure need
an explicit disposition; this ADR does not claim both happen atomically.

The BILL-18 matrix distinguishes deterministic adapter tests, real PostgreSQL
race/crash evidence and genuine Stripe test-mode lifecycle evidence. Unit
signature fixtures are not vendor lifecycle proof. BILL-H, live keys, production
deployment/data/identity, tax and legal/minors activation remain human-controlled.
