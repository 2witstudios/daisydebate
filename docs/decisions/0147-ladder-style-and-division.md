# 0147: A ladder is a style in a division

Status: accepted (owner decision 79, 2026-11-18; slice PYL S2 ladder divisions,
[plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/v9bh4dmdu4p9n519n9h210os),
confirmed by the point guard on Delivery). Amends
[ADR 0142](0142-freestyle-the-one-standard-and-ladder.md) §2 and §5, and
replaces the ranked age floor that PR 789 introduced (ranked play for members
18 and over only).

## Context

Ranked Rounds are published and licensed to Daisy, and a minor cannot agree to
that alone. Owner decision 79 therefore makes ranked play 18+ on **Open –
Freestyle**, and gives members under 18 their own ranked ladder, **Youth –
Freestyle**. There is one lobby for everyone. Adults may judge Youth Rounds but
may not debate in them, and a minor may not debate on Open. A member who turns
18 mid-season finishes that season on Youth.

ADR 0142 keyed every rating on `(actor, ladder, season)`, where the ladder was
the style. Nothing recorded who may play.

## Decision

1. **Vocabulary.** A ladder is `{ style, division }`.
   - Styles are `ratingStyles` (`['freestyle']`), renamed in TypeScript from
     `ratingLadders`.
   - Divisions are `ratingDivisions`: `open` (18 and over) and `youth` (under 18).
   - `daisyLadders` is every style in every division, so adding a style yields
     its Open and Youth ladders with no schema change beyond the composed CHECKs.
   - The pure rules live beside the vocabulary in `@daisy/protocol`
     (`ladder.ts`): `ladderKey`, `divisionOfAgeBand` (adult → open, any younger
     valid band → youth, no record → none), `divisionForSeatedDebaters` (unset,
     one division, or mixed), `seatedDivision`, and `roundCompetition`.
   - They sit in protocol, not debate-engine, because the database adapter
     applies them inside its fenced transactions and may not depend on the
     engine at runtime.
   - The age-band vocabulary moves to protocol for the same reason.
   - Stored column names stay: `ladder` and `ladder_id` hold the style.
2. **Storage.**
   - `seasons.division` is fixed when a season opens. There is one active
     season per organization and division, and each division activates its own
     Season 1.
   - `ratings.division` and `rating_changes.division` join their season on
     `(season_id, division)`.
   - A ledger row joins its Round on `(round_id, division)`, so a rating can
     sit neither on the other division's season nor on a Round of the other
     division.
   - `rounds.ladder_division` is null exactly when `ladder_id` is: it is frozen
     at Start and is the ratedness authority beside the style.
   - `challenges.division` is set exactly on a ranked offer.
   - Every CHECK is composed from the protocol vocabulary.
   - The migration backfills `open`. It reads and writes no rating value and
     cannot refuse.
3. **Who a member is.** A member's division comes from the stored birth month
   (ADR 0075's one band rule). The record must be valid now; the age is taken
   on the latest of three instants, never after now:
   - the start of Daisy's active Youth season, so a mid-season birthday
     finishes that season on Youth and Open starts with the next;
   - the member's own age record, so nobody is aged before they told Daisy,
     and a member who signs up at 18 is on Open from the start;
   - `YOUTH_CARRY_MONTHS` (12) ago, so a Youth season that never closes
     (DEC-111 keeps Season 1 open) holds nobody on Youth for more than a year
     past their 18th birthday.

   With no Youth season active, the member is aged now. The birth month never
   leaves SQL; pages name a ladder, never an age.

4. **A ranked Room's ladder follows who sits.**
   - The Room stores no division. Its seated human debaters set it: unset until
     one sits, then one division, or mixed. A stored copy would be a second
     truth beside the seats.
   - A member's own claim of a ranked debater seat is refused with
     `ranked-division` when the others already set the other division, or when
     the member has no division. The engine decides this
     (`rankedSeatClaimRefusal`).
   - A host's assignment, or an initial cast, may mix divisions.
   - At Start the Round freezes `roundCompetition`. One division gives a ranked
     Round on that ladder, which needs that division's active season (otherwise
     `ranked-unavailable`). A mixed seating gives a casual Round, with no
     preset and no ladder, while the Room stays ranked.
   - Judge seats take anyone.
   - Opening a ranked Room no longer depends on the host's age.
5. **Rating, reads and display.**
   - Rating uses the active season of the Round's division. Standings,
     carry-over and the rating advisory lock key on the ladder.
   - Standings, member cards, Room seats, the lobby's host rating and Round
     ratings take a ladder.
   - Every surface names a ladder with one formatter (`ladderLabel`: "Open –
     Freestyle", "Youth – Freestyle"). This replaces ADR 0142 §5's "one rating
     everywhere with no ladder switch": the leaderboard picks a ladder by
     division, landing on the viewer's own, and the profile and rail show one
     row per ladder.
6. **Challenges.** A ranked offer needs both members on one division. The
   challenge frame reads both divisions under the pair's lock, refuses
   otherwise with `ranked-division`, and stores the division. Casual is always
   offered.
7. **League ladders and tournaments** stay Open-only until their own divisions
   arrive (PYL S8, S9): a league-ladder Room seats only Open members, and
   tournament entries keep refusing under-18 entrants.

## Consequences

- The PR 789 ranked age floor (`RANKED_AGE_FLOOR`, `rankedAgeAdmitted`,
  `ranked-age`, the challenge send fence) is removed: division routing replaces
  it.
- `bun season activate-beta` opens each division's Season 1. `bun season open`
  takes `--division`. Opening the Youth season on staging is a builder's proof;
  on production it keeps human sign-off.
- The ranked content waiver is signed per member against their own division's
  season.
- Youth recordings, broadcast and media releases are later slices (PYL S3,
  S4). This decision changes no recording or broadcast rule.
