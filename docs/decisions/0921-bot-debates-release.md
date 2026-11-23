# 0921: Bot debates are a release; the flag wins over entitlement

Status: accepted (owner, 2026-11-23: "lets just put it behind a coming soon
and remove it from pricing/premium. put it behind a feature flag and we'll
work on it with only some users having access to it"). Builds on
[ADR 0117](0117-premium-billing.md) (Premium and the allowance) and
[ADR 0118](0118-release-and-ops-flags.md) (release flags and account
overrides).

## Context

Debating a bot was Daisy's most expensive gift and not yet good enough to
release. It was the Train page, an entry on Play, a bot in any casual Room's
seat, and a named part of what Premium sold ("Unlimited bot Rounds"). The
owner wants it out of the public product and out of the offer, still open to
the few accounts finishing it, so that pricing and Premium checkout can open.

A bot debate is admitted in one place: the Room's start-round freeze, which
reserves the host's `bot_debate` allowance and a slot of bot capacity in one
transaction (ADR 0058, ADR 0106). Train's Start practice, room setup, rematch
and a crafted request all reach a Round only through it.

## Decision

1. **One release flag, `bot-debates`**, off by default (`safeDefault: false`).
   "Only some users" is its account override with an expiry
   (`flag.override.update`); there is no second access mechanism, no list
   of accounts in code and no entitlement for it.
2. **The flag wins over entitlement.** Release is decided before allowance.
   A subscription, beta grant, club seat or the free lifetime allowance never
   opens an unreleased bot debate; with the flag on, today's allowance rules
   apply unchanged. The `ai_rounds` entitlement stays in the model and
   existing grants are kept: they are spent only where the flag allows.
3. **The account is the one the allowance is charged to**: the Room's host
   (`chargedHostOf`). For create, seating and Train it is the caller.
4. **The freeze is the authority.** The Room command carries the same
   trusted release closure Premium checkout uses
   (`releaseAdmission('bot-debates', releaseDefault)`, built by the Room
   composition, never at database open, so release flags stay out of client
   and proxy scopes), and the `bot_debate` reservation requires it on the
   charged host's account inside the reserving transaction, after the account
   fence and before the allowance decision. Refused, it answers
   `bot-debates-coming-soon` and leaves no reservation and no Round.
5. **Earlier refusals use the same word.** Room create (and rematch, which is
   create) and assign-seat refuse a bot in a debating seat with
   `bot-debates-coming-soon`; cast choices offer no bot debater; the host's
   bot notice says "Bot debates are coming soon." These read the
   request-scoped release reader; the freeze rechecks.
6. **Nothing after the freeze reads the flag.** Dispatch, speech, refunds and
   finalization never consult it, so a Round already running with a bot
   finishes normally when the flag turns off.
7. **The AI judge and Round analysis are not bot debates** and are not
   behind this flag.
8. **Off the offer unconditionally.** No page, email, metadata, help answer
   or plan card promises bot debates, whatever the viewer's flag. Train and
   Play's bot choice say "Coming soon" to a member without the release.
   Disclosures that stay true while any account debates a bot (the privacy
   notice's AI processing, the terms' "some opponents are AI debaters", the
   media-release terms) are not offers and stay.

## Consequences

- Staging resolves release flags on by default (ADR 0118). To match
  production, an operator sets `bot-debates` to `disabled` on staging and
  then adds overrides; a stored state wins over the deployment default, and
  an override wins over both.
- A free account's AI judge is admitted only together with its free bot
  Round (`freeJudgeUnbound`). With bots unreleased a free account can try
  Round analysis only; offering a standalone free AI judge would be an
  allowance change, decided separately.
- Browser and integration suites that need a bot grant their own accounts
  the override through the operator flag command, never a test bypass.
- Releasing bot debates to everyone is a flag state change plus restoring
  any offer copy the owner wants; no code path changes.
