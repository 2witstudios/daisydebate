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

**Stage quality (owner, 2026-11-03).** On a Round expecting a Broadcast, a browser
reporting at least 4 cores captures 540p, which adds a top simulcast layer over 180p
and 360p. Every other seat keeps its 360p baseline. The layer is there for the stage:
dynacast sends it only while a subscriber asks for it, and congestion control and
Chrome's CPU adaptation drop the highest layer first, so audio and the lower layers
keep their place. Under 960 wide (a 4:3 camera) the SDK keeps only 180p below the
capture, so 360p is not available there. The admission's `camera` value is a hint about
quality and decides no authority. If it cannot be read, the seat captures the baseline.

**Privacy boundary.** Revoking the observer's subscribe permission on the server
is the boundary; the page slate is appearance only. If revocation cannot be
confirmed, the Egress stops. The criterion is zero leak measured at the production
sweep's timing (point guard, 2026-11-03), not a lead on a rig. The sweep revokes at
the speech end, so every word of the last speech is kept: one value in
`stage-capture.ts` restores a lead if the measurement ever needs one. That is safe
because a private phase's microphones stay closed until the revocation lands, and on
a Round with a Broadcast its cameras do too, whether the phase was scheduled or opened
with no warning (prep, an early yield). They reopen once the observer is revoked, and
a public phase keeps its cameras. A Recording's own observer holds conversation, not
cameras.

**When the sweep dies.** While the observer may be subscribed, the hold stays, however
long that lasts, and the media reconciler raises `broadcast.conversation_held_long`
past 30 s. The stage also lets go of every track when it reads a private phase, as a
second layer that needs the stage route alive.

**When the control plane is gone: the guarantee.** Media captured after the last
heartbeat is never published, even if the web tier returns. Each reconcile claim
writes `control_heartbeat_at` by the database's clock, in the same update that appends
to `control_lapses` when the last heartbeat is 10 s old or more. So a returning web
instance records the lapse itself, no watcher has to be alive, and no restart can
forget one. The release step holds anything the heartbeat has not passed, and removes
anything touching a lapse before it counts, so what is removed leaves no hole in the
public sequence and is not released after the heartbeat resumes. A segment straddling
either boundary goes whole, so the precision is one segment (about 4 s) on each side,
plus 1 s for Egress's clock and the database's to disagree, always toward leaving
media out. A gap under 10 s is not a lapse: media waits and then goes out.

The public playlist marks a discontinuity at the gap. The Daisy player covers the
video with a slate after 5 s stalled, which is the whole of a gap on a delay policy,
and for 4 s when hls.js sees capture time jump, as on a hold released in one burst.
A native (Safari) player gets only the stall slate. A streaming tool carrying the
official feed gets no slate: it holds the last frame and then resumes.

A Recording reads the same record. The web copies `control_lapses` from the Broadcast
or the own capture into the job when it queues the build, because the Recording
worker's role reaches its jobs alone, and by then capture has ended and a returning
control plane has already written any lapse. The build skips the whole file of an
attempt that a lapse touches, joins the runs of segments outside it, and states the
stretch as a `control_lapse` gap. An own capture keeps its own heartbeat and lapses
in the same way, with no worker role involved.

**Ending the Egress.** That rule is the guarantee; ending the Egress only limits the
window. The stage page logs `END_RECORDING`, which Egress stops on, when the stage
route refuses on a stale heartbeat (410) or has failed for about 10 s. No process holds
a LiveKit credential for this. A control plane that returns finds the Egress complete
and starts the next attempt the normal way. A web restart of 10 s or more therefore
costs a running Broadcast a gap (see the deployment hold in `deploy-staging.md`).

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
