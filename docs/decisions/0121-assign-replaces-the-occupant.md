# 0121: Host assign replaces the seat's occupant

Status: accepted direction, owner-authorized room-work slice, 2026-11-08.

## Decision

One host `assign-seat` command names an actor and a seat, and the seat's
occupant — if any — leaves the Room in the same mutation. There is no
remove-then-add dance: assigning over a seated person replaces them, resetting
the rest of the cast's Ready consent through the ordinary edit fence. The
displaced occupant loses their active-Room membership exactly as `remove-seat`
frees them, and a bot's seat is freed the same way.

Constraints that stay in force:

- `claim-seat` never displaces: taking a seat someone holds is still
  `seat-unavailable` (the seat went first).
- A judge the host may not name — an heir's or seat-holding host's human judge
  (DEC-331, WATCH-6) — cannot be replaced either; closing the Room remains
  their answer to a stuck judge seat.
- Seat holds (ADR 0103) reserve free seats. A replacement takes an occupied
  seat, so holds never refuse a host's replacement.
- Ranked Rooms still refuse bot debaters, and the bot's own admission
  eligibility is read as before; replacement changes who sits, not who may sit.

## Consequences

`seat-unavailable` now means only: the slot does not exist, the seat was taken
or held from the claimer, or the seat's judge is beyond the host's naming
authority. The room command refusal copy says the same. The assignment
dropdown is the UI surface for replacement: the host picks the next occupant
from it, person or bot, and the old occupant is gone in one accepted command.
