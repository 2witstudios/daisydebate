# 0107: Recording and retention

Status: accepted, owner decisions on the Watch plan, 2026-11-02; amended for POVs, 2026-11-03. The retention of
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

**Takedown is not deletion.** It hides at once and keeps the objects, because ranked
video is the evidence behind disputes and integrity review. Moderation removes them as
a separate decision, and can restore a Recording taken down while ready. The takedown's
closed reason is stored on the Recording for the operator; the audience never reads it. Each is an
operator command in the admin app (`recording.takedown`, `recording.restore`,
`recording.remove`) naming the version the operator read, so a changed Recording is looked
at again. A takedown also ends the feed of the Round's open Broadcast in the same
transaction; a restore does not start it again. Listing and delivery are gone within
`CONTENT_MODERATION_DELIVERY_BOUND_MS`: a signed read lasts no longer than it, and a stop
reaching a Broadcast that already completed asks for its feed at once instead of waiting
out the grace (`feed_withdrawal_requested_at`, read by `claimFeedWithdrawal`). A ranked Round
leaves the archive with its Recording, and for the audience its transcript leaves the
Recording page too. A member seated in the Round keeps their own record.

**Downloads.** A subscriber may download any Recording they may watch and no other,
through a link signed for 60 seconds, rate limited. It is one whole-video file kept
beside the HLS, so processing keeps that file when it deletes its sources, plus each POV's files
below; the same check and the same rate limit answer all of them.

**Each debater has a POV (REC-1.6, owner and point guard, 2026-11-03).** A Recording, ranked or
recorded casual, also captures each debater's camera and voice apart, as private source for
two kept files: `video.mp4` (the picture with that debater's voice) and `audio.m4a`. It is
Recording's own concept: `recording_pov_captures`, `features/recording/pov-*` and
`@daisy/media/pov` borrow nothing from Broadcast. They share only `egressPrivacyActions`, the one rule
for any Egress in a Round's room.

- _Participant Egress, one per debater._ It follows republishes by identity, writes crash-safe
  segments and a fixed format, where a Track Egress ends at each of the microphone's unpublishes. It
  costs a transcode. A cheaper mix of Track and audio Egress is a later cost measure; it risks silent
  lip-sync drift no check can see.
- _Chosen from seats, never a room listing._ Only affirmative and negative seats get a row, so a
  hidden human judge is never captured, by construction. A bot gets voice alone.
- _The same gate._ Revocation keeps private media out of the hold where it works, but only
  `publicClips` decides what is kept. Anything not known to be public is slate.
- _In sync, in real time._ A POV starts at the composite's first frame and runs its length. Gaps
  are stated per POV: `not_public` or `capture_restart`.
- _Failure is local._ A POV that never ran, had nothing public or would not build is listed as
  missing, and the Recording is ready. The composite is the record; ranked evidence does not
  rest on POVs.
- _540p where the device can,_ 360p with a label, never a refusal.
- _Kept as the Recording is._ Removal, takedown, erasure and the evidence hold cover POVs through
  the same prefix and the same lifecycle, and anything a person can watch is kept after ranked
  erasure. The waiver and notices say so. **Not reviewed by counsel** (COMP-4).

**Capture spans every attempt.** A crash starts a new Egress under a new number, so a
Recording's capture is an ordered list of attempts. Each attempt is timed from its own
held playlist, and video time follows real time: the stretch between two attempts is that
long a stretch of slate, in the HLS and in the download, and is listed in `media.gaps`. A
Recording never pretends to be continuous. A speech marker claims nothing inside a gap.

**Coverage is stated against the Round's own record.** When media is verified, the capture
port adds to the worker's restarts what the Round's segments, prep and media room rotations
say the video shows as something else (`coverageStatement`): a private phase, which is the
stage's slate, and a room rotation, stated at an estimated 5 seconds because no one records
its end. Debate before the first frame or after the last has no place in video time, so
`media.unrecorded` states it apart: a late start, an early end, or a stopped Broadcast. The
worker reads none of this: its login reaches its job table and nothing else.

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

**What persists.** The manifest is the composited one, listing each debater's POV beside it, and
only a Recording's current state, its version and operator receipts persist; there is no raw-track
manifest and no transition history (point guard, 2026-11-03).

**Polling is the mechanism.** The capture sweep reads each Egress from LiveKit on every
pass, so a lost, forged, duplicated or reordered webhook cannot change anything. Webhooks
are at most hints, and no receiver is needed (point guard, 2026-11-03).

**Two capture paths, one job.** POVs run beside either, and the job carries them. A Round with a Broadcast reads that Broadcast's Egress. A
casual Recording with no Broadcast runs its own, in `recording_captures`, and obeys the
same privacy rule (`egressPrivacyActions`). The stage page and its credential are their own
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
- A Broadcast stopped before its watermark passes the Round's end holds the Recording
  back from the audience. Releasing it then is a moderation decision not yet built.
- POV Egress revocations add to what private conversation and cameras wait on, and a POV holds
  a build back at most two minutes after capture ends.
- POV video has two generations: the Egress's encode and the worker's, because a frame-exact cut
  and slate cannot be stream copied. Its audio file adds none.
- POV capacity is its own Egress pool. Machine size is set by a load run, not by this decision.
- Reads authorize per request, one indexed read per media segment. Replay load is
  unmeasured; WATCH-4 proves it, and a short-lived grant cache is the expansion path.
