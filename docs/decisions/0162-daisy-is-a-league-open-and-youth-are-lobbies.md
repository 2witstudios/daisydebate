# 0162: Daisy is a league; Open and Youth are its standing lobbies

Status: accepted (owner decisions 91 and 92, 2026-11-19). The target model;
the slices that move the code to it are in the
[league lobbies plan](#build-order). Supersedes
[ADR 0156](0156-room-division-from-its-lobby.md). Amends
[ADR 0131](0131-the-lobby-is-the-one-container.md) §5 and §6 and
[ADR 0147](0147-ladder-style-and-division.md) (a division becomes a lobby's
age rule). Replaces PYL-16 (a league carries one division) and the
tournament `entry.age_division` setting.

## Context

ADR 0131 made the lobby the one container: an organization owns standing
lobbies, a ladder belongs to one standing lobby, and every Room sits in
exactly one lobby. When Youth arrived, it was not built on that model.
ADR 0147 added a division dimension to ratings, ADR 0156 §1 then said
outright that Open and Youth "are not the `lobbies` table" and stored them as
`rooms.division` with an immutability trigger, PYL-16 gave a league a single
division, and tournaments gained their own `entry.age_division` setting.
Seasons open through `scripts/season.ts`. The result is one concept (where a
member may compete) spelled four ways, each with its own fences, so every
later feature had to patch all four and the patches contradicted each other.

The owner's direction: "open and youth are just lobby/ladders within the daisy
org"; "if I want to create a tournament I just do it as a league director and
I don't have to run code"; "that should just be how all leagues work"; "the
only unique thing about daisy vs other leagues is that daisy is in the ui
given first class".

## Decision

1. **Daisy is an ordinary league.** Nothing in code or schema names Daisy's
   organization id or treats it differently, except presentation (§6). The
   CHECK that exempts Daisy's id from `league_division` goes with that column.
2. **Open and Youth are standing lobbies** that Daisy's league owns, rows in
   `lobbies` like any league's. Every league may own an Open lobby, a Youth
   lobby, both, or others.
3. **Where a member may compete is a property of the lobby**: its age rule
   (adults, under 18, or anyone), a lobby setting. A member's age band comes
   from the stored birth month, aged at the start of the lobby's active
   season (ADR 0147 §3 unchanged). A minor may also compete in an adult lobby
   when their guardian has allowed that lobby (`restriction_lobbies`,
   decision 92). Judges are unrestricted, as today.
4. **Ladders and seasons belong to a standing lobby.** A ladder belongs to
   one standing lobby (ADR 0131 §5 unchanged). A season belongs to a standing
   lobby, one active per lobby (amends ADR 0131 §6, which said one per
   organization). A league manager creates lobbies, ladders and seasons in
   the league host area; no script, seed or flag opens one in production.
5. **Rooms, Rounds, challenges and tournaments read eligibility from their
   lobby.** A Room's lobby is already its one parent for life (ADR 0131 §2),
   so `rooms.division`, its trigger and `challenges.division` are replaced by
   the lobby. A ranked Round rates on its lobby's ladder; `rounds` keeps its
   frozen ladder copy. A tournament lobby names the standing lobby it runs
   under and inherits that lobby's age rule; a guardian's permission for a
   lobby covers its tournaments. Guardians do not approve individual entries.
6. **Daisy's first-class place is presentation only.** An organization may
   be marked official; standing lobbies owned by official leagues appear
   automatically as options in the lobby screens (the lobby switch, the
   leaderboard, Watch, the home Play tile). Creating such a lobby makes it an
   option with no code. A member lands in the official lobby whose age rule
   fits them.
7. **Differences between lobbies are deliberate and few.** Every rule that
   differs between an adult and a youth lobby must be listed in compliance.md
   Children with its decision. Today's list: who may debate (the age rule,
   plus guardian permission), the content licence (ADR 0161), takedown of
   youth recordings, Youth Room chat (decision 84), DM consent (ADR 0160) and
   linked adults seeing through private (decision 89). Anything else that
   differs is a defect.

## Consequences

- New code must not add reads or writes of `rooms.division`,
  `challenges.division`, `league_division`, `entry.age_division` or season
  scripts. Code that needs eligibility takes the lobby (or the lobby's age
  rule) as its input, so the migration replaces one value, not a call site's
  logic.
- `packages/protocol/src/division-lobby.ts` (`seatAllowed`,
  `roomLobbyAtCreation`, `canWatchLive`, `lobbyOf`) becomes rules over a
  lobby's age rule and the member's age band and guardian permissions.
- The data migration creates Daisy's Open and Youth standing lobbies, moves
  the existing ladders, seasons, Rooms and challenges onto them, and drops
  the division columns, trigger and CHECKs in the same slice that moves their
  last reader.
- League managers open, edit and close seasons in the league host area. Closing
  pauses new ranked starts in the lobby and keeps season history available.

## Build order

One plan carries this ADR, parental controls (decision 92) and finishing
Daisy Tab, because all three key on the lobby: the lobby model lands first,
then guardian permission per lobby, then Tab's eligibility. The plan is on
PageSpace under Plans and on the Delivery channel.
