# 0131: The lobby is the one container

Status: accepted (owner direction, 2026-11-13; built in the Daisy Tab schema
slice, TAB-4). Amends section 7 of [ADR 0058](0058-one-round-model.md): a
Room now has a parent. Amends [ADR 0055](0055-glicko-2-calculation-ladders-and-seasons.md) and
[ADR 0090](0090-three-rating-ladders.md): a season belongs to an
organization and a ladder to a standing lobby; Daisy's are unchanged.

## Decision

1. **One container, two kinds.** A lobby is `standing` (open-ended, always
   owned by an organization) or `tournament` (bounded, owned by a person or
   a league, never a school). A tournament is not a second container: it is
   a one-to-one extension row holding only schedule state. Grants, settings
   and restrictions key on the lobby. A lobby has no access column; who may
   see and join it is its `audience.posting` setting.
2. **A Room sits in exactly one lobby**, its only parent. Every Room made
   before lobbies existed, and every Room a writer makes without naming one,
   sits in Daisy's seeded public lobby by column default.
3. **A Room has a host person exactly when its lobby is standing**, by a
   CHECK over the lobby's kind, which a composite foreign key proves. In a
   tournament lobby authority over a Room comes from grants on the lobby.
   The Room and Round engine does not learn about lobby kinds: until the
   format and wiring slices teach it shared hosting, the Room readers refuse
   a Room with no host person as an invariant breach.
4. **An event Room is always casual.** With the existing ranked-ladder check
   on Rounds, no tournament can move a ladder, by construction.
5. **A ladder belongs to one standing lobby**, and to that lobby's
   organization. Daisy's three ladders belong to the public lobby and keep
   their ids. The ladder CHECKs on `ratings` and `rating_changes` stay, so a
   league's ladder row may exist while nothing can be posted to it; lifting
   that for a league's lobby is the wiring slice's decision to record.
6. **A season belongs to an organization**, one active per organization.
   Daisy's rating seasons are Daisy's.
7. **A Round gains no column.** It reaches its fixture through the Room it
   froze from; the fixture points at its Room and nothing points back.

## Consequences

- A lobby's Room listing filters by `lobby_id` in the query: `rooms` is
  exempt from row-level security ([ADR 0129](0129-tenant-isolation-by-row-level-security.md)).
  The single parent means an event Room cannot be in the public lobby, but
  the public lobby's reads must still filter.
- Nothing in the database forces a tournament lobby to have its extension
  row; the one command that creates a tournament creates both.
- The recording rule for event Rooms (`off` or `officials`, never
  `released`) is added by the format slice, which owns the Room's recording
  pin.
