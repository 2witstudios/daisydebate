# 0147: Host tiers: free up to 16 entries, one payment per event

Status: accepted (owner decision 80, 2026-11-18; slice PYL S8 host-tiers,
[epic plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/dvjf9nlzrhaojb2vw4n5ufrw),
tasks PYL-14, PYL-15 and PYL-16). Amends the personal hosting gate of the
Tab lobby rules (a `tournament_hosting` grant is no longer needed to make a
tournament of your own) and [ADR 0117](0117-premium-billing.md) (a second,
one-time Stripe offer beside Premium).

## Context

Until now a person could make a tournament only while holding a current
`tournament_hosting` grant, issued administratively. Decision 80 makes
hosting open to anyone: a free event takes up to 16 entries with no
recording, AI judging or broadcast; one payment for that event, which never
renews, unlocks them and raises its cap (USD 99 up to 64 entries, USD 199
unlimited). League hosting is sales-led (S9) and not part of this.

## Decision

1. **The tier belongs to the hosted tournament.** The boards' "this event"
   is the tournament as a whole (the Friday scrimmage), so the cap counts
   accepted entries across all its events. The vocabulary and its pure rules
   live in `@daisy/protocol/lobby/hosting-tier`: `free` (16), `event_64`
   (64, USD 99), `event_unlimited` (no cap, USD 199);
   `eventAllowance(tier, acceptedEntries, feature)` → `allowed` |
   `upgrade_required(reason)`; `hostingUpgrade(current, target)` → the amount
   still owed (USD 100 to move from 64 to unlimited) or `held`.
2. **The tier is derived, never stored twice.** It is the highest paid
   `tournament_hosting_purchases` row, else free. A league's tournament is
   covered by the league, and a current administrative `tournament_hosting`
   grant naming the tournament counts as unlimited; grants stay the
   administrative path.
3. **Anyone adult hosts their own tournament.** The personal creation gate
   (`hostingPlan`, refusal `plan-required`) is removed. A league still needs
   its own administrative plan.
4. **Enforced at the domain command.** A submission past the cap is held
   pending (automatic approval and a host's own entry included), and
   `accept-entry` past the cap is refused `hosting-upgrade-required`; the
   tournament row is locked so entries on different events count in turn.
   `set-setting` refuses `hosting-upgrade-required` for switching
   `recording.capture`, `judging.ai_judge` or `broadcast.live` on at a free
   tournament's lobby or event. A free tournament's event Rooms never
   record, whatever the stored value. The per-event `entry.cap` setting stays
   its own rule.
5. **Purchases are their own table.** `tournament_hosting_purchases` holds
   the tournament, the payer, the tier, the amount (the difference on a
   move), the mode, the state (`open`, `paid`, `expired`) and Stripe's
   session and payment intent ids and receipt URL. One open purchase per
   tournament; card details never enter it. It is fenced by the lobby scope.
6. **One-time Checkout.** The checkout route takes only the tier; the
   amount comes from the tier held. A session is a `payment` Checkout with an
   idempotency key from the purchase id, metadata naming the purchase and
   tournament, and either the configured price or, for the move to
   unlimited, the difference against that price's product. Prices come from
   `STRIPE_HOST_EVENT_64_PRICE_ID` and `STRIPE_HOST_EVENT_UNLIMITED_PRICE_ID`,
   verified by amount, mode and lookup keys `daisy_host_event_usd_99` and
   `daisy_host_event_usd_199`. They are an optional group: without them the
   upgrade page says checkout is unavailable and Premium is unaffected. An
   open purchase for the same move is resumed; one for another move is
   expired at Stripe before a new one opens.
7. **Settlement trusts only Stripe's own session.** The billing webhook
   routes `checkout.session.completed`, `async_payment_succeeded` and
   `expired` events that name a hosting purchase to settlement, which
   retrieves the session and settles only when its id, purchase, tournament,
   mode, amount and payment state all match. Settling is guarded by the
   purchase still being open, so a repeat is a no-op; the checkout return
   page runs the same settlement.
8. **Hosting pages.** `/host` (host home and the create form), the event's
   Upgrade and Billing pages and the panels on Entries and Setup sit behind
   the `host-tiers` release flag, which depends on `daisy-tab`. The payer
   is the signed-in host; paying as an organisation waits for S7's club
   billing. The rules themselves (open personal creation, the cap, the paid
   switches) are not a release: wherever `daisy-tab` is open, a personal
   tournament is free-tier even while `host-tiers` is closed, and can be
   made through the lobby command, though without the host home or a way to
   pay. A tournament named by an administrative grant stays unlimited while
   the grant is current; when it lapses, the tournament is held to the free
   tier until `host-tiers` opens or the grant is renewed.
9. **Paid recording is funded by the purchase.** A tournament paid for
   funds its event Rounds' capture admission the way a hosting grant does,
   with a concurrency limit per tier.

## Consequences

- AI judging and broadcast in event Rooms have their switches and
  enforcement but no pipeline yet (decision 76 keeps event Rounds on Tab's
  release gating; ISSUE-1465, ISSUE-1466). Until they do, no page sells
  them: the upgrade and Billing pages promise recording and the entry cap,
  and Setup shows the two switches as coming to paid events.
- Refunds and disputes of a hosting payment are not reconciled yet: a
  refunded purchase stays paid and the tournament keeps its tier until an
  operator acts. ISSUE-1470 moves the purchase to refunded from the signed
  refund event.
- Waiting entries are accepted by the host after payment; nothing writes
  entries from the payment path.
- Divisions (PYL-16, after PR 792): a tournament declares its division as
  the `entry.age_division` setting (`open` by default, `youth`), chosen on the
  host home's create form and shown on Setup and the host home. An entrant's
  age band is read on the tournament's first day (its earliest time slot, or
  now while none is set): `divisionAdmission` refuses an adult at a Youth
  event `over-youth-age` and a minor at an Open one `under-open-age`, at
  `submit-entry` and `replace-entry-member`; `divisionRefusalWords` says why
  in the entrant's terms. Minors stay behind the guardian and counsel gate,
  so today a Youth event admits no one until that gate opens.
- Tab event Rounds are casual and rate on no Daisy ladder; a tournament's
  seeding reads its league ladder. So no Round is rated on (Freestyle, the
  event's division) yet; when Tab Rounds become rated they take that ladder.
- The public tournament page (ISSUE-1472) and the host's refused-entries list
  and division editor (ISSUE-1473) wait: neither page exists yet.
