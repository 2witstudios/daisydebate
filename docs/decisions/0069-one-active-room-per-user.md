# 0069: One active Room per user

Status: accepted; owner decision 2026-10-26 (room lifecycle brief).
Extends [ADR 0058](0058-one-round-model.md) §5a and
[ADR 0067](0067-playable-round-policy-and-acceptance.md); supersedes the
per-host `ROOM_POLICY.maxOpenRooms` cap.

## Context

A host could hold several open Rooms up to a configured cap, and any member
could sit in any number of Rooms at once. Nothing tied a user to the Room
they were in, so the shell and lobby could not say "your room", a guest could
wander into two debates, and abandoned Rooms stayed open forever. Leaving a
live Round was a link that changed nothing on the server.

## Decision

1. **One active Room per user, enforced by PostgreSQL.** A Room is active
   while it is `assembling` or `ready`, or `started` with a `scheduled` or
   `active` Round. `room_active_memberships` holds one row per human actor
   such a Room holds — its host and its seated humans — with `actor_id` as the
   primary key. That key is the invariant: a second create or join cannot
   commit. Bots hold no row.
2. **The engine decides the member set.** Every accepted Room mutation
   carries `members` (`activeRoomMembers` in `@daisy/debate-engine`); the
   Room writer makes the rows equal to it in the same transaction and
   refuses with `active-room` when another Room holds a member, rolling the
   whole command back. Two concurrent claims on one actor serialize on the
   key: exactly one commits. A Round's end (`writeProjectionWithPhaseSignal`
   taking it out of play) deletes its Room's rows.
3. **Refusal.** `active-room` joins the closed Room refusal vocabulary (409
   `CONFLICT`). The HTTP refusal also carries the caller's own `ActiveRoom`
   read, so the UI returns them to it instead of showing a generic error.
4. **Terminal states free members.** Host Close; a seated host leaving
   (closes the Room); a guest leaving (frees only them); a live Round's
   Leave, which posts the existing forfeit command and so ends the Round;
   idle expiry; and any Round end.
5. **Idle expiry.** `ROOM_POLICY.idleTimeoutMs` is optional with no
   default; absent, expiry is inert. The maintenance sweep closes an open
   Room whose last accepted command, or the end of its running pre-round
   prep, is at least that old by database statement time. The engine's
   `expireIdleRoom` decides under the Room's row lock (`SKIP LOCKED`); the
   SQL candidate query is only a prefilter.
6. **My active Room.** `@daisy/protocol`'s versioned `ActiveRoom` (`id`,
   `title`, `phase: assembling | ready | live`, `role: host | debater |
   judge`, `href`) is read through `GET /api/rooms/active` and server-side in
   the shell layout and the lobby. No realtime push yet.
7. **Greenfield replacement.** `maxOpenRooms`, its advisory lock and its
   tests are deleted; a `ROOM_POLICY` naming it is refused at startup. The
   migration backfills memberships for Rooms open or live at migration time,
   keeping a user's newest Room where several held them.

The privileged multi-Room path for tournament organizers is deferred until
real tournaments exist.

## Consequences

- A debater stays in their active Room while a finished Round awaits its
  ballot (up to the ballot deadline); Leave then goes to the lobby without a
  forfeit.
- A judge has no Leave in a live Round; the Round's end frees them.
- Deploying requires the `ROOM_POLICY` secret to drop `maxOpenRooms` first.
