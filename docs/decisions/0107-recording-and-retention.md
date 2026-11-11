# 0107: Recording and retention

Status: accepted, owner decisions on the Watch plan, 2026-11-02. The retention of
ranked video after erasure is **proposed and not reviewed by counsel** (COMP-4), and
may change after that review.

## Context

The Watch plan keeps ranked Rounds forever as qualifying artifacts, makes other
recording a host's paid opt-in, and replaces the historical per-camera shape with one
composited video. The archive and replay screens ran on samples, and nothing owned a
Recording's state, lifetime or deletion.

## Decision

**One concept, one home.** `features/recording` owns Recordings: one table, one
lifecycle, its own jobs. It borrows nothing from Broadcast or the transcript. It
reads the Round, the Broadcast watermark and the floor intervals as named, read-only
inputs, and takes the download entitlement from WATCH-8 the same way.

**State is one value.** `recordingLifecycleSchema` is a discriminated union, so ready
without media or removed with media cannot be represented. `transitionRecording`, beside
it in `@daisy/protocol` so the feature and the store share it, is the only place it
changes: pure and total, run under the row lock by `moveRecording`, the one writer. A repeat is `unchanged` and an out-of-order
report is `refused`, so a crash or an ambiguous vendor answer is resolved by reporting
again. `ready` is reachable only from verified media.

**A stable identity and a speech timeline.** One Recording per Round. Ready media
holds who spoke when, in video time, so anything derived from it can record its source
Round, time range and people (`derivedMediaSource`).

**Audience.** Default deny. `roundEvidencePermissions` decides video, transcript and
result independently. The audience learns nothing of a Round until the Broadcast
watermark passes its end (ADR 0099): a held Round answers exactly as a missing one.
A public casual Recording shows its video and neither its text nor its result.

**Private bucket, authorized reads.** Every object is under `recordings/<id>/`. A
playlist is answered by the app, so its relative paths come back through the check;
media redirects to a read signed for 60 seconds. Nothing in the bucket is public.

**Removal.** A participant removes a casual Recording, whole; the transition refuses
ranked. Erasure counts as that request for every casual Recording the member sits in,
and never touches ranked. A casual Recording already taken down, with an open report on
it or its Round, survives erasure, hidden, with the removal owed on its lifecycle: it goes
when the report closes or 90 days pass. Until then it cannot be restored, and moderation
cannot remove it, with one exception: `recording.legal_remove`, an operator's removal with
a required closed legal ground, written to the admin audit chain, because some content must
be removable whatever a hold says (point guard, 2026-11-03). `removing` is a durable intent held on the row, carried out
by a bounded, idempotent sweep that ends only when the prefix lists empty.
A participant's removal or an erasure also ends the Round's open feed, in its own transaction.

**Takedown is not deletion.** It hides at once and keeps the objects, because ranked
video is the evidence behind disputes and integrity review. Moderation removes them as
a separate decision, and can restore a Recording taken down while ready. The takedown's
closed reason is stored on the Recording for the operator; the audience never reads it. Each is an
operator command in the admin app (`recording.takedown`, `recording.restore`,
`recording.remove`) naming the version the operator read, so a changed Recording is looked
at again. A takedown, a moderation removal and a legal removal also end the feed of the Round's
open Broadcast in the same transaction; a restore does not start it again, and gives the audience
the video back, since only an operator's stop of the Broadcast withholds the media. Listing and delivery are gone within
`CONTENT_MODERATION_DELIVERY_BOUND_MS`: a signed read lasts no longer than it, and a stop
reaching a Broadcast that already completed asks for its feed at once instead of waiting
out the grace (`feed_withdrawal_requested_at`, read by `claimFeedWithdrawal`). A ranked Round
leaves the archive with its Recording, and for the audience its transcript leaves the
Recording page too. A member seated in the Round keeps their own record.

**Downloads.** A subscriber may download any Recording they may watch and no other,
through a link signed for 60 seconds, rate limited. It is one whole-video file kept
beside the HLS, so processing keeps that file when it deletes its sources.

**Capture spans every attempt.** A crash starts a new Egress under a new number, so a
Recording's capture is an ordered list of attempts. Each attempt is timed from its own
held playlist, and video time follows real time: the stretch between two attempts is that
long a stretch of slate, in the HLS and in the download, and is listed in `media.gaps`. A
Recording never pretends to be continuous. A speech marker claims nothing inside a gap.

**Coverage is stated against the Round's own record.** When media is verified, the capture
port adds to the worker's restarts what the Round's segments, prep and media room rotations
say the video shows as something else (`coverageStatement`): a private phase, which is the
stage's slate, and a room rotation, stated at an estimated 5 seconds because no one records
its end. The worker knows only what is not proven public, so each of its `not_public` gaps
is explained against the same record (`explainGaps`): a stretch inside a prep or another
private phase is `private_phase`, and a turnover is `between_speeches`, the counterpart of
the stage's `between`. A turnover runs from a closed segment's end into the next segment by
the start-edge stamp lag of ADR 0099 at that age, plus 1.2 s of slack, which is 2.5 s for a
young capture. A window reaches into a speech's opening only for a gap that comes from the
slate before it, and back 2.5 s into the speech it follows only for a gap that runs on into
the slate (public media stops short of a speech's end), so a gap that stays inside a speech
is lost however near its edge it is. Only a
window a committed segment closes explains anything: a gap after an open segment, after the
last one or in a prep no segment follows stays `not_public`. The history page states a
ready Recording's stored gaps the same way when it is watched, so a Recording built before
this explanation reads as one built today, with no stored data changed. Only a restart, a
rotation and an unexplained `not_public` stretch are debate lost. Debate before the first
frame or after the last has no place in video time, so `media.unrecorded` states it apart:
a late start, an early end, or a stopped Broadcast. The worker reads none of this: its
login reaches its job table and nothing else. None of it changes what is published.

**Preparation says how far it really is.** A running build writes its figures on its own
job row, in each step's units: attempts read, milliseconds encoded as ffmpeg counts them,
files uploaded. There is no percentage of the whole, because nothing measures one. The
viewer and the Recording page read that, fenced to the lease's current owner.
`recordingProcessingBoundMs` is half the media's length plus five minutes, from the
capture's end. Past it an operator is alerted once, viewers are told it is delayed, and it
keeps retrying: a timer never fails or discards a Recording, and a ranked Recording is kept
forever (point guard, 2026-11-03). `failed` means the retries ran out, with an alert.
A failed ranked Recording keeps its capture and its sources; no sweep removes them, and an
operator can rebuild it (`recording.rebuild`), from a report or the failed recordings page.
A run past three times the bound (`recordingBuildCeilingMs`, sized by the web, since the
worker reads only its job) is stopped and counted as a failed attempt, which retries, and
`recording.build_ceiling_exceeded` is raised. Nothing is discarded. The bound counts queue
wait, because that is what a viewer waits through; the ceiling counts one run.

**What persists.** The manifest is the composited one, and only a Recording's current state,
its version and operator receipts persist; there is no per-track manifest and no transition
history (point guard, 2026-11-03).

**Polling is the mechanism.** The capture sweep reads each Egress from LiveKit on every
pass, so a lost, forged, duplicated or reordered webhook cannot change anything. Webhooks
are at most hints, and no receiver is needed (point guard, 2026-11-03).

**Two capture paths, one job.** A Round with a Broadcast reads that Broadcast's Egress. A
casual Recording with no Broadcast runs its own, in `recording_captures`, and obeys the
same privacy rule (`stagePrivacyActions`). The stage page and its credential are their own
module (`features/stage-capture`) because both use them.

**Processing is its own worker.** `apps/recording-worker` claims `recording_processing_jobs`
and fences itself the way the Broadcast worker does: lease, renewal, epoch. It lives apart
from the Broadcast worker because a build is a bulk job that would take cores from a live
release, and each feature owns its jobs and capacity. It is not in the web app because the
web image carries no ffmpeg and a build must survive a web restart. Its login reaches its
job table and nothing else, so it reports `built` and only the capture port can make a
Recording ready. The hold keeps its sources until the Recording no longer needs them and
no Broadcast or Egress can still read them.

## Consequences

- Capture and processing call `RecordingCapturePort`. They do not write the table.
- The job row exists from the first attempt, so a removal mid-capture still reaches what
  the capture left in the hold bucket, and `removed` waits for it.
- A Broadcast an operator stopped before its watermark passes the Round's end holds the
  Recording back from the audience. Releasing it then is a moderation decision not yet built.
- Reads authorize per request, one indexed read per media segment. Replay load is
  unmeasured; WATCH-4 proves it, and a short-lived grant cache is the expansion path.
