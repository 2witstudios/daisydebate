# 0933: The Premium mark and where a free account is offered Premium

Status: accepted (owner instruction, 2026-11-25; slice premium-mark, PR 933).
Amends [ADR 0146](0146-premium-twenty-unlimited-fair-use.md) §8 (the upgrade
moments) and [ADR 0045](0045-daisy-brand-system.md) (gold was reserved for
honours and events).

## Context

Premium had no mark of its own. The upgrade panel borrowed a gold sparkle,
which elsewhere means AI, and nothing showed that a member holds Premium.
ADR 0146 §8 offered Premium at four moments, all before or during a Round.
Recording casual Rounds is the main reason to buy Premium, because watching a
Round back is how a debater studies and improves, yet nothing offered it at
the moment a debater looks for a replay that does not exist.

## Decision

1. **The Premium mark is the Daisy bloom in one colour, gold.** It draws the
   same petals as the logo (`PremiumMark`, over `DaisyMark`'s `mono`
   variant). The logo is always forest, sage and yolk, so a gold bloom means
   Premium and nothing else. Gold now carries honours, events and Premium;
   honours stay chips with words, and the Premium mark is a bare glyph.
2. **It does two jobs.** Beside a member's name it says that member holds
   Premium, by the same validity rule that gives access, and it is visible
   to everyone who can see the name. In an upgrade panel it marks the offer.
   It replaces the sparkle in `UpgradePanel`.
3. **One panel a screen.** A screen shows at most one upgrade panel, so one
   mark and one Get Premium button. A second Premium limit on the same
   screen is an `UpgradeLine`: the fact as a sentence with a link to
   `/premium`. On the Room page the roster's AI judge panel is the panel,
   and a capture reach beside it answers with the line. The Edit settings
   sheet is modal, so it is its own screen and keeps its panel.
4. **Two more moments**, each where the account reaches for the thing, each
   with a way on, none with a count:
   - **An unrecorded casual Round.** On the Recording page of a casual Round
     that was never recorded, its debater or host who lacks the capture
     entitlement sees "Watch your next one back" under the empty video.
   - **Download.** An account that lacks only the download entitlement sees
     the Download control: it may watch the ready video and the reuse fence
     (ADR 0161) does not hold it. Pressing it shows the panel in place and
     requests nothing.
5. **Never on a Youth Round, and never on a guess.** A Youth Round's page
   makes no offer. An entitlement read that fails makes no offer. The
   Recordings list makes no offer at all: its rows carry no Youth fact
   (ADR 0161), so it cannot keep this rule. A row says "Not recorded" and
   opens the Round's page, which can.

## Consequences

- The Recording page reads one more entitlement, and only when a casual
  Round's own debater or host opens it unrecorded.
- A free account now learns that downloading exists. The API still answers
  a free account's download as not found.
- The mark beside names needs each name's read to say whether its member
  holds Premium. Those reads do not share one projection (profile cards,
  standings, seat labels), so they adopt it one surface at a time.
- The four moments of ADR 0146 §8 stand. The offer still never appears to a
  Premium account, and a Premium account at the fair-use ceiling still sees
  a plain line with no upsell.
