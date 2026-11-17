# 0145: Room teams, open seats and the seat draw

Status: accepted (owner, 2026-11-16). Extends
[ADR 0058](0058-one-round-model.md)'s Room seats,
[ADR 0076](0076-pre-round-resolution-draw.md)'s draw and
[ADR 0104](0104-round-owns-its-opening.md)'s Start round.

## Decision

A Room seats **teams**, and the Round decides their sides. The pre-round Room
is a roster: one row per seat, each debater choosing a Team, a Side and a
Position, any of them `?`. `?` is decided at Start round, fairly and
visibly, by one draw. A coin flip is the `?` of Side.

- **A Room seat's role is its team's placement, not its side.** Team 1 sits
  in the `affirmative` seats and team 2 in the `negative` ones. The Room's
  `team_one_side` holds the side team 1 argues, or null for the coin flip.
  Every debater still holds one concrete seat before Start, so capacity, the
  unique seat indexes, the Tab cast and everything after the freeze are
  unchanged. A Round's role is always the side.
- **Start round makes the Room's seats concrete.** The draw writes each
  debater's side into their Room seat and sets `team_one_side` to
  Affirmative, so a started or closed Room's role reads as the side, exactly
  as before this ADR. Before Start, `team_one_side` is the side rule, and the
  draw's result lives only in `rounds.seat_draw`. A page names a Room seat by
  its side only through the rule: by side once it is fixed, by team (and
  position) while it is open.
- **`?` is two flags on a seat.** `team_open` (the team is random) and
  `position_open` (the slot within the team is random). A random team implies
  a random position, and a judge is never open, by CHECK.
- **Moving.** `set-seat` moves a debater to a team (or `?`) and a position (or
  `?`). A member moves their own row and the host anyone's. A seat taken by a
  debater whose team is `?` (or, within a team, whose position is `?`) is
  free to swap with, since that debater was going to be placed at random.
- **Sides.** `set-sides` sets team 1's side or null. The host or any seated
  debater may, since sides are the debaters' to agree. A ranked Room's sides
  stay null until Start, by CHECK (`rooms_ranked_sides_open_check`): ranked
  play always flips. Teams of different sizes keep the side
  their seats were declared for. Both commands clear every Ready.
- **The seat draw.** Start round mints one seed per Round
  (`round_draw_seeds`, the same CSPRNG and SHA3 streams as
  [ADR 0076](0076-pre-round-resolution-draw.md), domain
  `daisy-draw-v1/seats`). Debaters whose team is `?` are shuffled over the
  seats they hold, then each team's `?` positions over its slots, then the
  coin decides the sides if they are open. Debaters are taken in canonical id
  order and seats in placement order, so the same seed and seats always give
  the same Round. It runs before the resolution draw, which then reads real
  sides.
- **The draw is public and immutable.** `rounds.seat_draw` holds the
  algorithm, a commitment over the Room, Round, seats and seed, the coin
  (`kept`, `swapped`, or null when the sides were fixed), the resolved
  `teamOneSide`, and every debater the draw moved. A trigger keeps it
  unchanged once written. The Round opening shows it first: "Coin flip", the
  viewer's side, and who was placed by `?`.
- **Defaults.** A new Room's sides are open, except a cast that names a
  debater (Tab) stays fixed and teams of different sizes are fixed. Practice
  flips like any Room. Existing Rooms were fixed on Affirmative by the
  migration, which is what they already played, except ranked Rooms that had
  not started, which keep the flip.
- **The page.** The roster shows Side always, and Team and Position only when
  a team seats more than one. Ready is a mark in each row; the viewer's own
  "I'm ready" sits under their tile. Who can join (its own `set-visibility`
  command), Broadcast and Record are on the page; everything else is in a near-full-screen Edit settings dialog
  opened from a read-only preview.

## Why

A coin flip had to decide sides fairly and visibly for the ranked queue and
Daisy Tab. Bolting a flip onto sides would have left British Parliamentary and
seeded side choice with nowhere to go. Teams with a `?` model all of them:
BP is more teams, and a high seed choosing a side is a fixed side set before
Start.

## Consequences

- `room_participants.team_open`, `position_open`; `rooms.team_one_side`;
  `rounds.seat_draw` with its immutability trigger
  (migration `20261117033250_room_seat_teams`).
- `round_draw_seeds` moves to its own Round-owned schema file
  (`schema/round-seeds.ts`): both draws read their own stream from its seed.
- `RoomView` gains `teamOneSide` and each seat `teamOpen`, `positionOpen` and
  its `rating`; `RoundOpening` gains `sides`.
- More than two teams (BP) is a later room setting on the same model; it
  needs a team count beside the seat counts and is not built here.
- Seeded side choice (a tournament's high seed picks) is `set-sides` by the
  Tab before Start, not a new mechanism.
