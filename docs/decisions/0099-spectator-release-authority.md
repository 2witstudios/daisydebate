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
- A completed Broadcast: no more media will come, so what it held leaves behind
  the Broadcast's own release policy.
- A stopped Broadcast: the spectator timeline has ended. It shows as ended, stays
  at the watermark the stop left, and no fact appears after the stop. The
  competitive record does not end with the video, so standings, a listed rating
  and a public profile treat a stop as they treat completion.
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
never skip media; real delay above 90 seconds raises an alert (DEC-303), logged as
`broadcast.release_delayed` from the web, because a dead worker is the likely cause.

**Media path.** A Web Egress renders Daisy's stage page under a server-minted,
subscribe-only observer token held by no other browser, and writes HLS segments
and a file. Room Composite is rejected: deleting its room ends it, or leaves it
active and writing silence. Daisy stops the Egress, and the reconciler stops any
whose Round is terminal.

**Privacy boundary.** Revoking the observer's subscribe permission on the server
is the boundary; the page slate is appearance only. If revocation cannot be
confirmed, the Egress stops. The criterion is zero leak measured at the production
sweep's timing (point guard, 2026-11-03), not a lead on a rig. Where a speech end is
scheduled, the sweep revokes 2 s ahead, which is its 1 s period, a late pass and
the call. A private phase with no schedule, prep or an early yield, is revoked
after it opens: its microphones close by grant, and conversation stays held until
the revocation lands.

**When the sweep dies.** Nothing on a timer revokes for it, so the observer stays
subscribed. What bounds that is the hold, not a duration: while the observer may be
subscribed, conversation stays closed however long that lasts, and speech ends by
grant, so no private talk exists to reach it. Cameras stay published in a private
phase and are not held. The stage lets go of every track when it reads a private
phase, as a second layer that needs the stage route alive. The media reconciler
raises `broadcast.conversation_held_long` past 30 s. If the whole web tier is down,
grants stop changing too, and the microphone open at that moment stays open until
it returns. That case has no bound in code.

**Stray Egress.** The first start recorded for a generation wins. A loser's
credential is never stored, so the stage refuses it, it never signals Egress to
record, and it writes nothing. The loser stops its own Egress; a crash before the
record leaves one that a sweep every 15 s finds in LiveKit's active list by its
stage URL and stops, under the capture's claim, which a start holds for 15 s.

**Delivery.** Daisy owns it, with no video vendor. Segments enter a private
Tigris bucket. The release step alone holds a credential for a separate public
bucket; it encodes 720p, 480p and 240p and writes the manifests, so timing stays
Daisy's. Per-object public access is not used for the hold, because one wrong
flag would publish held media early. A CDN is added only if Tigris misses the
DEC-303 targets.

**Official feed.** The public master playlist is the official feed, for players
and for streamers (Stream this Round). It ends with the Broadcast: a stop withdraws
every public object at once, and a completed Broadcast's are withdrawn 60 s after
completion, which viewers need to reach the end (real viewers finish about 13 s
after completion). OBS reopens an ended address on a loop and would otherwise put
the last 24 s back on air for as long as the source stays up, and a later takedown
would leave a public copy behind. Afterwards the Recording is the only copy.

**One-click push, later.** Pushing to Twitch or YouTube stays out of this release
(WATCH-17). The later path is LiveKit Egress's external stream URLs, which need no
new vendor. One constraint comes with it: the Egress works ahead of the hold, so a
stream output from it would carry undelayed media. A push must take released media,
never the Egress's own live output, on any Round with a delay.

## Evidence

Staging, BCAST-1: revoking 500 ms before a private marker left no marker audio in
10 ms windows and no marker frames, in 6 of 6 windows; revoking about 310 ms after
it was detected in 3 of 3. Web Egress kept one egress across room rotation locally
with a gap of about 100 ms.

Not recorded here yet: Web Egress when its room is deleted (the finding above that
mentions deletion is about Room Composite), an attempt to reach undelayed media on
the real pipeline, Egress and encoder CPU on Fly, startup, and end-to-end delay.

## Consequences

- Live reads and listings stay closed to non-participants; the spectator timeline
  is the one read they get.
- Staging LiveKit and Egress share a Redis, superseding DEC-228 for this purpose.
