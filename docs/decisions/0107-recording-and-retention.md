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
without media or removed with media cannot be represented. `transitionRecording` is
the only place it changes: pure and total. A repeat is `unchanged` and an out-of-order
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
and never touches ranked. `removing` is a durable intent held on the row, carried out
by a bounded, idempotent sweep that ends only when the prefix lists empty.

**Takedown is not deletion.** It hides at once and keeps the objects, because ranked
video is the evidence behind disputes and integrity review. Moderation removes them as
a separate decision, and can restore a Recording taken down while ready.

**Downloads.** A subscriber may download any Recording they may watch and no other,
through a link signed for 60 seconds, rate limited. It is one whole-video file kept
beside the HLS, so processing keeps that file when it deletes its sources.

**Capture spans every attempt.** A crash starts a new Egress under a new number, so a
Recording's capture is an ordered list of attempts. Each attempt is timed from its own
held playlist, and video time follows real time: the stretch between two attempts is that
long a stretch of slate, in the HLS and in the download, and is listed in `media.gaps`. A
Recording never pretends to be continuous. A speech marker claims nothing inside a gap.

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
- Only capture restarts are recorded as gaps. A private phase is the stage's slate, in the
  video; naming it in `media.gaps` needs a durable record of revocations, which no one
  keeps today.
- A Broadcast stopped before its watermark passes the Round's end holds the Recording
  back from the audience. Releasing it then is a moderation decision not yet built.
- Reads authorize per request, one indexed read per media segment. Replay load is
  unmeasured; WATCH-4 proves it, and a short-lived grant cache is the expansion path.
