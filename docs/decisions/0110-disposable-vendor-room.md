# 0110: A vendor room is disposable

Status: accepted by the point guard on the owner's behalf, 2026-11-03. Amends the
uncertainty rules in [ADR 0053](0053-live-video-self-hosted-livekit.md) section 3.
Plan: [Media resilience](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/dhe6qaazttq79tnn38dpcp0w).

## Context

ADR 0053 says a vendor write with an unknown outcome blocks admission until it is
resolved, and that restart never clears the uncertainty. It named no way to resolve
one. A call that fails on a dead node has already rejected, so nothing can ever settle
it. One lost permission call therefore closed a Round's media for the rest of the
Round, with no way back.

Measured on two local LiveKit v1.13.7 nodes sharing Redis, by killing one:

- The survivor keeps listing the dead node's rooms, and answers their participant
  lists with 200 and empty. Listed does not mean alive.
- A permission update on such a room answers 404. A delete answers unavailable, or
  `could not find object` once the node has returned under a new id.
- A join through the survivor works and moves the room to a live node, 6 of 6. A create
  does the same, and a delete then succeeds.
- LiveKit stops choosing the dead node within about 3 s. Against a frozen node the
  survivor takes 3.07 s to answer, and a direct call hangs past 8 s.

## Decision

**A vendor room is disposable; the media session is not.** When a room's state is
uncertain, the session retires it and takes a fresh opaque name. Seats and identities
stay. Capture leases bump their epoch, so capture relaunches into the new room.

**A retirement fences uncertainty; it does not resolve it.** An intent still pending
settles as `superseded`, which claims nothing about what the vendor did. A late write
can then reach only a name that no token uses. A late acknowledgement cannot rewrite
that outcome.

**When.** At once on observed absence, or once uncertainty is 6 s old by the PostgreSQL
clock: the 5 s the adapter waits on one call, plus 1 s. Restart still clears nothing,
since the age comes from the durable record. Before that bound, admission and opening
stay refused as ADR 0053 requires. Terminal sessions use the same rule, so a Round can
end while its node is dead.

**What stays behind.** An empty late-created room closes itself by `empty_timeout`. A
client still in a retired room on a partitioned node can talk only to others there: no
capture, judge or floor reaches it.

**Node list.** `LIVEKIT_URL` and `LIVEKIT_PUBLIC_URL` each take one or more nodes, comma
separated, in matching order. One entry behaves as one node always did. Reads move past a
node that faults, since asking twice changes nothing. A write goes to one node, since a
second attempt could not tell what the first did. A probe every second decides which node
clients join through. With none healthy every node is still tried, because a probe can be
wrong. Any node reaches any room through LiveKit's Redis.

**A blip is not a drop.** The browser SDK resumes the same connection for up to 5 s with
its tracks. Past that it is a drop and joins the one recovery loop.

## Consequences

- A lost call now costs one rejoin, not the Round's media.
- Every unsafe episode rotates the room, so everyone in it reconnects, even after a blip
  that a read-back might have proved harmless. Chosen for one rule over a cheaper path.
- `media_vendor_mutations.outcome` gains `superseded`.
- `capture-session-history` treats a room change inside a segment as an interruption, which
  the platform incident (SFU-12) must excuse.

## Platform incident

Round pause, resume and the incident ending are added by SFU-12; see
[the design](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/uoz563x4d98j4qpe41qkx4hw).
