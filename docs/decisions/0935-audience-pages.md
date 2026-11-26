# 0935: Audience pages, each for one reader

Status: accepted (owner brief of 2026-11-19 and design review of the
"Daisy marketing pages" canvas; owner instruction of 2026-11-25; slice
marketing-pages, tasks MKT-1 to MKT-7; GUIDES-9 of
[ADR 0912](0912-public-guides-and-learning.md)). Changes the access
rules: the `/leagues` root is public.

## Context

Daisy's public pages said what Daisy is (`/about`) and what it costs
(`/pricing`), but none spoke to a particular reader. A parent, an NCFCA
family, a coach, a league director and a tournament director each ask a
different question, and each had to work out the answer from pages written
for everyone.

## Decision

1. **Five public pages, one reader each.** `/ncfca` for an NCFCA family,
   `/parents` for a parent, `/coach` for a coach or club, `/leagues` for a
   league director and `/tab` for a tournament director. They sit in the
   product shell, are readable signed out, and are written as a case in
   running prose, never as a feature list.
2. **A page says only what the product does today.** Every claim was
   checked against the code. Where the design canvas said more than the code
   does, the page says less: practice bots are not offered while
   `bot-debates` is unreleased; a linked parent or coach follows a Youth
   Round live by its clock, speaking order and transcript, and sees video in
   the Recording; a recording of a casual Round needs its host to hold
   Premium; `/tab` names the three pairing methods a host can choose and
   makes no claim of venue check-in; `/leagues` says Daisy sets a league up
   with it, because a league cannot yet create itself.
3. **Every number comes from its owner.** Prices from `planPrices`, the seat
   bound from `clubSeatBounds`, NCFCA speaking order and times from the
   format catalog, the ballot's groups and categories from the current
   rubric. Copy spells no amount.
4. **A closed release leaves no trace.** Each destination follows its own
   release flag, read as `/pricing` reads them. A link whose release is
   closed is left out, never shown as "coming soon". A page whose own main
   action is closed does not exist: `/parents` with `parental-controls`,
   `/coach` with `club-seats`, `/leagues` with `league-requests`, `/tab`
   with `host-tiers`. `/ncfca` needs none.
5. **NCFCA is named nominatively.** The name says whose published rules the
   practice rounds follow, and the page carries one line saying Daisy is not
   affiliated with, endorsed by or sponsored by NCFCA.
6. **Only the `/leagues` root is public.** `guardedAreaFor` answers null for
   the bare root of an area listed as a public root; `/leagues/<slug>` and
   everything under it stay guarded. No other area has a public root.
7. **Linked from About.** A "Daisy for" row on `/about` lists the pages that
   are open. The rail and the More menu list product destinations and gain
   nothing.
8. **"Coach" stays a human.** The reserved-word rule admits the audience
   pages and About's row, where the word names a human coach.

## Consequences

- A page can fall behind the product in both directions. When bot debates,
  venue support in Tab, self-serve leagues or a coach view ship, the page
  that held back should say so; when a behaviour changes, the page's claim
  must be checked again. The unit tests bind the numbers, links and the
  forbidden wording, not the prose.
- On a deployment with no stored release state, only `/ncfca` exists, and
  it links only to sign-in.
- Help and About still describe leagues as "early access"; that copy is not
  changed here.
