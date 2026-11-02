# 0099: Spectator release authority and owned delivery

Status: accepted, owner decisions and point guard rulings on the Watch plan,
2026-11-02. Supersedes the "Live timing and separate access boundaries" section
of [ADR 0067](0067-playable-round-policy-and-acceptance.md) for spectators, and
amends [ADR 0048](0048-authorization-core.md).

## Context

ADR 0067 made `GET /api/rounds/:id` live, undelayed timing for anyone entitled
to `round.read`, and public and unlisted visibility granted that read. Ranked
Rounds must now be broadcast on a 60 second delay as a competitive integrity
requirement, so an open live read would defeat the delay.

## Decision

**Live reads.** `round.read` needs a seat or the host. Public and unlisted decide
who may watch the Broadcast, never who reads undelayed clock, phase, floor or
outcome. Until the spectator timeline exists a non-participant has no Round read
at all, and a Room view carries no Round reference for them.

**Undelayed observer.** `round.observe.undelayed` is held by a seatless host on
any Round, because a seatless host acts as an event host. A competitor who hosts
gains nothing from hosting. Event moderation authority joins it when Daisy's
tournament portal exists. Operators use the admin app (ADR 0043).

**Delay is a floor.** Media and facts are never early. The hold publishes a
durable released-through watermark, and the server releases a fact only once the
watermark has passed its capture time, plus a margin for viewer latency. The
spectator timeline follows media actually released, not the clock. Ranked Rounds
never skip media; real delay above 90 seconds raises an alert (DEC-303).

**Media path.** A Web Egress renders Daisy's stage page under a server-minted,
subscribe-only observer token held by no other browser, and writes HLS segments
and a file. Room Composite is rejected: deleting its room ends it, or leaves it
active and writing silence. Daisy stops the Egress, and the reconciler stops any
whose Round is terminal.

**Privacy boundary.** Revoking the observer's subscribe permission on the server,
at least 500 ms before a private phase, is the boundary; the page slate is
appearance only. If revocation cannot be confirmed, the Egress stops.

**Delivery.** Daisy owns it, with no video vendor. Segments enter a private
Tigris bucket. The release step alone holds a credential for a separate public
bucket; it encodes 720p, 480p and 240p and writes the manifests, so timing stays
Daisy's. Per-object public access is not used for the hold, because one wrong
flag would publish held media early. A CDN is added only if Tigris misses the
DEC-303 targets.

## Evidence

Staging, BCAST-1: revoking 500 ms before a private marker left no marker audio in
10 ms windows and no marker frames, in 6 of 6 windows; revoking about 310 ms after
it was detected in 3 of 3. Web Egress kept one egress across room rotation locally
with a gap of about 100 ms. The remaining BCAST-1 measurements are on the plan.

## Consequences

- Reads and listings for non-participants return only with the spectator timeline
  (BCAST-5), so WATCH-6 cannot ship without it.
- Staging LiveKit and Egress share a Redis, superseding DEC-228 for this purpose.
