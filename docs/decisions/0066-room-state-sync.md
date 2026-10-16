# 0066: Rooms and rounds synchronize as resources, not routes

Status: proposed; implementation authorized by the owner on 2026-10-16.

## Context

The assembling room (`/rooms/[id]`) and the live round
(`/rounds/[id]/room`) kept themselves current by calling `router.refresh()`
every five seconds (`RoomRefresher`). Each refresh re-ran the route's whole
server render: the shell layout or bare page, the durable session read, and
every projection the page reads. On 2026-10-14 a database outage of about
fifteen seconds made one background refresh throw `INFRASTRUCTURE`. The
root error boundary replaced the room, unmounting `AssemblyDeviceReadiness`
and disposing its camera and microphone controllers and local consent
state, although nothing about the room had changed and nothing the viewer
did had failed. The live round, which holds media, was exposed the same
way.

The fault is architectural. A page needs its authoritative resource kept
current; it does not need the route's rendering lifecycle run every five
seconds to get it. Route refresh couples fetching, deciding the current
state and rendering into one call, and turns a transient read failure into
an exception that tears down browser-local state the server never owned.

What a resource-level design needs already existed:

- every accepted room mutation publishes a content-free `room.changed`
  doorbell carrying the room's `changeVersion` on `room:<id>`, and every
  persisted round revision a `debate.phase-changed` doorbell carrying the
  round's version on `debate:<id>` ([ADR 0049](0049-room-debate-turn.md)
  §7, [ADR 0032](0032-transactional-outbox-delivery.md));
- `readAssembly` and `readRoundReceipt` read `/api/rooms/:id` and
  `/api/rounds/:id` and answer `found | missing | unavailable` without
  throwing;
- `attachInvalidationTopic` already turned a topic's doorbells,
  `resync_required` frames and errors into refetch signals for messaging;
- the device subtree took authoritative updates through
  `consent.updateView` without recreating its controllers.

## Decision

### 1. A page holds its resource in client resource sync

The server render seeds the page with the resource (a `RoomView` with its
command identifiers, or a `RoundView`). After hydration resource sync, not
the route, is the source of what the page renders. A failure to read is
state, not an exception: the page keeps the last value it adopted and marks
it `stale`; a resource that no longer reads is `gone`. Neither reaches an
error boundary, so nothing the server never owned is unmounted. A notice
says when what is on screen may be out of date.

### 2. Transitions are one pure reducer

`features/resource-sync/resource-sync.ts` is a pure function of the sync
state and one event (`signal`, `read`, `found`, `unavailable`, `missing`,
`accepted`), parameterized by how values are identified and ordered. It has
no clock, timer, network or React; time arrives as an event field. Its
rules:

- a value is adopted only when its version is not older than the one held,
  so an out-of-order answer never rolls the page back; an equal version is
  adopted because time-derived fields move without a mutation, and a
  resource may keep part of what it held (a room keeps the command
  identifiers it already offered);
- a doorbell whose version the held value covers is ignored; a doorbell
  newer than an in-flight read makes another read due when it settles;
- reads are single-flight, with at most one more due;
- a failed read schedules nothing, so an outage is paced by the backstop
  and never becomes a read loop.

### 3. Effects stay at one edge

`features/resource-sync/driver.ts` owns the side effects and only
dispatches events. It subscribes to the resource's doorbell, reads through
an injected reader, re-signals on `resync_required`, on a realtime error,
when the realtime connection reopens or ends and when the tab becomes
visible, reads again at a deadline the resource names (a room's running
prep), and polls as a backstop (thirty seconds while current, five while
stale) because doorbells have no delivery guarantee yet. Without a
configured realtime endpoint it polls alone. Rooms and rounds are thin
consumers: `createRoomSyncDriver` and `createRoundSyncDriver`.

### 4. Reads name where their doorbell rings

The room read and the round read answer with `x-realtime-socket-url` when
realtime is configured, as the messaging reads do, so a page learns its
endpoint from the read it already makes and no page reaches the process
edge.

### 5. Hydrated room commands adopt the answer instead of navigating

A hydrated room command, edit or consent intent hands its accepted
canonical `RoomView` to room sync; the page does not navigate. Launch
(`start-round`) still navigates to its round. A refused or unreachable
command shows its error in place and signals a read. Without JavaScript
nothing changes: the server action still answers with a 303 to the room, or
to the room with `?notice=command-refused`, per the
[UI conventions](../development/ui-conventions.md).

### 6. Command identifiers come from one pure builder

`roomCommandIds(view, nextId)` builds every identifier the room's forms
need. The server uses it for the first render, so hydration matches; room
sync uses it for each newer view, so an accepted command's identifier is
never offered again.

### 7. A round that is no longer live leaves explicitly

When the synced round is no longer live for this debater, the page
navigates to its receipt. That transition used to happen only because a
background refresh re-ran the page's server redirect.

### 8. Route refresh is removed

`RoomRefresher` and `startRoomRefresh` are deleted with their tests. Both
routes render once per navigation; the error boundary is reached only when
a navigation itself fails.

## Consequences

- A database outage leaves an open room or round showing its last known
  state with a reconnecting notice; device previews, media and consent
  intent survive it.
- The prep countdown ticks every second from the last read instead of in
  five-second steps, and the read at its deadline picks up the finished
  prep and the capabilities that depend on it.
- Background load drops from a full route render every five seconds to one
  resource read per change, plus a thirty-second backstop.
- Room sections render on the client after hydration. They already were
  client-compatible components and gain no server-only dependency.
- `attachInvalidationTopic` lives in `features/realtime`, used by messaging
  and, through `attachVersionDoorbell`, by rooms and rounds.
- Messaging still refetches with `router.refresh()` on its doorbells. It
  has the same route-level coupling and should move onto resource sync in
  its own change.
