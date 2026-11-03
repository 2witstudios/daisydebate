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
outcome. A non-participant has no Round read at all, only the spectator timeline, and a
Room view carries no Round reference for them.

**Spectator timeline.** One named read serves the audience:
`GET /api/rounds/:id/timeline`, anonymous, the same for every viewer, cached for
one second by any CDN and never holding a socket. It reads no session and sets no
cookie. A private Round, or one with no Room, is one not-found answer. An unlisted
Round is served to anyone holding its link (DEC-302) and never indexed; the link
is the Round's id, the same way an unlisted Room is reached today.

**How far the timeline has reached.** `spectatorHorizon` in the domain states it,
and `spectatorHorizonSql` states it for list reads that filter in the database; an
integration suite holds the two equal. A fact leaves once the horizon has passed
its capture time by the margin:

- An open Broadcast: its watermark alone, never the clock.
- A completed or stopped Broadcast: no more media will come, so what it held
  leaves behind the Broadcast's own release policy.
- No Broadcast, Round still live: nothing is released, on any Round.
- No Broadcast, Round ended: a casual Round has nothing holding it. A ranked Round
  is always meant to have a Broadcast, so this is a capture failure or capture not
  yet active; its record must not hang on the video, so it leaves behind the fixed
  ranked delay.

**What each fact's capture time is.** A result and its ballots, the Round's
completion. A rating, the later of its posting and the completion. A caption, when
its line was stored. The resolution, the Round's start. Captions, winner, scores,
reason and ratings are public on ranked Rounds only (plan section 5, DEC-301); a
tie has a null winner. Judges are never named and side feedback never appears.

**Reads outside the timeline.** Standings, the leaderboard and a listed host's
rating rebuild a rating from the ledger: it stands where the earliest unreleased
posting found it, and a debater with no released posting is not listed yet. A
public profile lists neither the Round nor its tally until release. A person with
an authorized Round read still reads that Round's own rating at once.

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

- Live reads and listings stay closed to non-participants; the spectator timeline
  is the one read they get.
- Staging LiveKit and Egress share a Redis, superseding DEC-228 for this purpose.
