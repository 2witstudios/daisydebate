# 0146: Premium at $20, unlimited, with a per-day fair-use ceiling

Status: accepted (owner decision 78, 2026-11-18; slice PYL S5 premium-20,
[epic plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/dvjf9nlzrhaojb2vw4n5ufrw),
tasks PYL-9, PYL-10 and PYL-11). Amends
[ADR 0117](0117-premium-billing.md) (the price, the five-bot-debate period
quota and the member usage display) and
[ADR 0058](0058-one-round-model.md) (the flat beta monthly cap,
`AI_ROUND_MONTHLY_CAP`, is retired).
Amended by [ADR 0148](0148-club-seats.md): Club seats grant the same
Premium, from source `organization_seat`, under the same renewal grace.
Amended by [ADR 0933](0933-premium-mark-and-upgrade-moments.md): the
Premium mark, one panel a screen, and two more upgrade moments.

## Context

ADR 0117 sold Premium at USD 10 a month with five bot debates per Stripe
billing period, and showed members "N of M remaining" in the Room and on
the billing page. The owner's pricing decision (78) makes Premium USD 20 a
month and unlimited: bot Rounds, casual AI judging and Round analysis carry
no counter anywhere. The only bound is an abuse ceiling per day, set well
above anyone debating for real. A free account keeps one bot Round, one
AI-judged casual Round and one analysis, ever, and meets a small upgrade
panel at the moment it reaches for one of them.

## Decision

1. **One pure allowance rule.** `allowanceVerdict(tier, kind, usedToday,
usedThisPeriod)` in `packages/auth/src/allowance.ts` returns `allow`,
   `free-limit-reached` or `abuse-ceiling`. The lifetime source is the free
   tier; a subscription or a beta grant is Premium. Free compares the
   period (lifetime) use with one; Premium compares today's use with the
   ceiling for that kind and never counts the period. `admitAllowance`
   keeps source selection, grace, grants and the free-judge binding as
   before and refuses with the verdict. A bundle (a bot Round with its
   judge) admits whole or not at all.
2. **The ceilings are one trusted config.**
   `packages/auth/src/allowance-ceilings.ts` holds them: per UTC day, 12 bot
   Rounds, 24 casual AI judges and 24 analyses; the free tier's one. No
   environment variable sets them. A test may pass tighter ceilings to
   reach them.
3. **Today is a UTC day, read under the account fence.** The ledger reader
   (`readAllowanceLocked`) counts holding reservations for the quoted
   source and for the quote's UTC day (`allowanceDay`), at most two indexed
   counts per requested kind (`usage_reservations_actor_day_idx`). A day
   that changes between the read and the requote is read again. Released,
   refunded and credited use never counts, as before.
4. **Reads carry only the decision.** The Room's `botAdmission` is the
   refusal or null; `aiJudgeSeating` is `free`, `included`, `premium` (the
   free one is used, including when bound to another Round), `with-bot` (the
   free AI judge comes only with the free bot Round), `not-included` (any
   other refusal) or `fair-use`; the analysis view says `locked` only for a
   spent free analysis and adds `fair-use`; billing settings carry no usage
   at all. No count, limit or period leaves the
   decision, and the contract schemas refuse one.
5. **The new price.** `premium-price.ts` names the offer a new Checkout
   sells: USD 2000 minor units a month, Stripe lookup key
   `daisy_premium_monthly_usd_20`. A session Checkout creates must be that
   offer, by amount and lookup key, so a deployment still configured with the
   old price refuses it rather than selling it. Reading back a session that
   already exists also accepts the grandfathered offer, so a Checkout opened
   before the change and paid after it completes.
   `STRIPE_PREMIUM_PRICE_ID` must name the new price (PYL-19, owner).
6. **Existing subscribers keep their price.** Subscription, invoice and
   closure reads accept the grandfathered USD 10 offer as well as the new
   one, and an invoice settles a period only at its own subscription's
   amount. Each purchase already froze its price id, so a grandfathered
   subscription keeps verifying against its own price. Moving existing
   subscribers to USD 20 stays an open owner decision.
7. **Billing shows the plan, not usage.** A verified observation's
   renewal-off (cancel at period end or on a set `cancel_at` date) and price
   amount are stored beside the evidence
   (`billing_subscriptions.renewal_off`, `amount_minor`), for display only:
   access still comes from verified evidence alone. Rows fill on each
   customer's next scheduled reconciliation. The billing page shows paying
   yourself (price and renewal date), cancelled (renewal off, Premium until
   the paid end, Keep Premium), Premium granted by beta access (nothing to
   pay, no checkout) and paid by a club (a state S7's Club seats will
   produce). Card digits are never
   stored, so the page shows none. The checkout return confirms Premium
   only when current evidence shows it; otherwise the pending notice stays.
8. **Upgrade panels in place.** A free account sees one panel at each of
   four moments: starting a second bot Round, seating an AI judge on a
   casual Round, requesting a second analysis, and turning on recording or
   broadcast as a host. Each offers Get Premium (to `/premium`) and a way
   on (debate a person, invite a judge, or Not now). A Premium account at
   the ceiling sees a plain fair-use line with no number and no upsell.

## Consequences

- The beta grant behaves as Premium for quantity: unlimited up to the
  ceiling. `AI_ROUND_MONTHLY_CAP` and `AI_ROUND_MONTHLY_CAP_MAX` are gone; an
  environment that still sets the variable is unaffected.
- The ceiling bounds an abusive Premium account's AI cost per day; its
  value is a code change with review, not a deploy setting.
- `/pricing` (S6) and Club seats (S7) add the "Compare plans" and "About
  Club" actions the Premium board shows; until then the page has no link to
  a page that does not exist.
