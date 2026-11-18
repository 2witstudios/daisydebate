# 0148: Club seats — one organisation-owned plan, Premium per seat

Status: accepted (owner decision 78, 2026-11-18; slice PYL S7 club-seats,
[plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/kfogl8y62qkp1vpt01qf7det),
[epic plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/dvjf9nlzrhaojb2vw4n5ufrw),
task PYL-13; point guard confirmation, Delivery 5111). Amends
[ADR 0146](0146-premium-twenty-unlimited-fair-use.md) and
[ADR 0117](0117-premium-billing.md): billing was owned by an account only.

## Context

Club is USD 10 per seat a month for coaches, schools and homeschool
families. Each seat holder gets Premium. The board's design: start a club,
invite by email, assign, move and remove seats, change the seat count with
an immediate proration, a club billing page, and Settings › Billing showing
"Seat from <club>". Billing until now assumed one subscriber account per
customer, purchase and subscription, quantity one, and one invoice line.

## Decision

1. **A billing owner.** `billing_customers`, `billing_purchases` and
   `billing_subscriptions` carry exactly one of `user_id` or
   `organization_id` (CHECK `num_nonnulls(...) = 1`), with owner-scoped
   unique indexes. A purchase freezes its `quantity` (1 for Premium, 1–200
   for a Club); a subscription stores the verified `seat_count`. Fences
   order: account fences (sorted), then the organisation row, then billing
   rows. Every user-keyed pipeline (refunds, closure, erasure, invoice pass,
   usage economics) stays account-only by construction.
2. **A club is a Tab organisation** of kind `school` (the board's "Club": a
   school or club) or the new kind `family` (a homeschool parent's own
   club). It is created through Tab's organisation command; an adult may
   create a family as well as a school. Its owner is its manager. A seat is
   not a membership: ending a seat never ends the membership; accepting a
   seat makes the person an active member.
3. **Pure seat rules** (`@daisy/protocol/club-seats`): seats used = seats
   held + live invitations ≤ seat count; one seat per account across all
   clubs (also a unique index); an invitation holds a seat for 14 days, then
   holds nothing and cannot be accepted; lowering the seat count below seats
   used is refused unless exactly the released seats and invitations are
   named.
4. **Seat grants are a projection** (`clubSeatGrants`, `@daisy/auth`): each
   seat holder within the paid seat count has the five Premium grants with
   source `organization_seat`, bounded by the same verified period as
   personal Premium, including DEC-364's 7-day renewal grace while
   `past_due` (the past_due policy); `canceled`, `unpaid` and grace beyond
   seven days grant nothing. If Stripe's seat count is cut below the seats
   held outside Daisy, the earliest assigned keep Premium. Seat commands
   and reconciliation rewrite the holders' grants in the same transaction;
   nothing writes a seat grant by hand. Usage under a seat is attributed to
   the source `organization_seat`, never to self-paid Premium.
5. **Removal ends Premium at the end of that UTC day** (the approved board;
   point guard, Delivery 5111). Removing or moving a seat frees it at once
   and truncates the former holder's seat grants to the next UTC midnight;
   a later reconciliation never extends them.
6. **Stripe.** Checkout sells `quantity: N` of the Club price (lookup key
   `daisy_club_seat_monthly_usd_10`, `STRIPE_CLUB_SEAT_PRICE_ID`) and
   returns to the club's billing page. Seat increases are in-app subscription
   updates with `proration_behavior: always_invoice` and
   `payment_behavior: error_if_incomplete`, so Stripe's quantity rises only
   once the proration is paid; a declined card changes nothing. Decreases
   release the named seats first, then lower the quantity with no proration
   or credit. The Club portal (`STRIPE_CLUB_PORTAL_CONFIGURATION_ID`) allows
   payment method, invoices and cancel, never quantity. Both ids are an
   optional pair inside the Stripe group: Club may be off while Premium is
   on.
7. **Club observation is its own normaliser.** Premium's schemas stay one
   seat and one non-prorated line. A Club invoice may have several prorated
   `subscription_update` lines; it is owned but never settles a period. Only
   a `subscription_create` or `subscription_cycle` invoice of one
   non-prorated line at seat price × seats settles a period. The read takes
   a page of ten paid invoices and refuses (retries) rather than read the
   plan as unpaid when the settling invoice lies beyond it. Reconciliation
   reads an organisation's claim as a Club plan; the webhook inbox and loop
   are unchanged.
8. **Invitations.** An invitation stores a normalised email and is sent as
   durable mail (`club-seat-invitation`) that names the club; the dedupe key
   carries the club so the worker reads the one invitation under its scope.
   The link names the invitation and carries no credential: only a signed-in
   account whose verified email is the invited address can see or accept it.
   Answering, cancelling or purging an invitation cancels its unsent mail.
   Lapsed invitations are purged 30 days after they lapse; erasure removes
   the subject's seat and the invitations addressed to them.
9. **Release.** Everything is behind the `club-seats` release flag; durable
   purchase admission checks it in the purchase transaction.
10. **A member who already pays for Premium** and accepts a seat keeps their
    own subscription until they cancel it; Settings › Billing shows their own
    plan, and the accept page tells them so with a link to manage it.

## Consequences

- One subscriber concept now has two owners; any new billing scan names its
  owner explicitly.
- Card digits are never stored or shown.
- Staging and live proof with Stripe test mode needs the owner's Club price
  and portal configuration (PYL-19).
- Not built here: media releases (S4), Youth tournaments and any coach view.
