# Recordings

Operator runbook for Recordings ([ADR 0107](../decisions/0107-recording-and-retention.md)).
Retention and lawful basis are in [compliance](compliance.md), and are proposed
until counsel reviews them.

## Storage

Objects live in a private Tigris bucket, set by `RECORDING_BUCKET_ENDPOINT`,
`RECORDING_BUCKET_NAME`, `RECORDING_BUCKET_ACCESS_KEY_ID`,
`RECORDING_BUCKET_SECRET_ACCESS_KEY` and optionally `RECORDING_BUCKET_REGION`. It has
no public access. Every object of a Recording sits under `recordings/<id>/`, which
is what lets deletion reach all of it. Without these settings the app serves no
object and the sweep deletes nothing: intents wait, and each attempt reports
`recording.deletion_failed`.

Creating the bucket and its secrets is a deploy-rail change with human sign-off.

## Capture and processing

A Round with a Broadcast is recorded from that Broadcast's Egress. A casual Round whose
host opted into recording alone runs its own Egress of the same stage page, with the
same observer revocation and the same microphone hold. `RECORDING_CAPTURE=on` turns on
the capture sweep; unset, no Recording is requested and no Egress starts for one.

The stage page keeps recording when it cannot reach the media server. Its connection
(`ui/broadcast/stage-connection.ts`, run by `stage-connector.ts`) makes one connect
attempt at a time, and a failed attempt lets its room go so the next read tries again.
Reads run once a second and may overlap; the poll (`stage-poll.ts`) applies whole
answers in order and drops a late, older one. Until a room is joined, a speech shows
"Reconnecting to the debate" with its tiles hidden. Only the stage watch ends the
recording, never a media failure.

Every Egress attempt writes under its own number in the private hold bucket:
`hold/<broadcastId>/<attempt>/`, or `recording-hold/<recordingId>/<attempt>/` for an own
capture. A crash starts the next attempt. The web's sweep (one pass a second) records
each attempt, and ends capture once the Round is over or the Broadcast stopped and
LiveKit reports no Egress running. There is no timer.

`apps/recording-worker` then does the bulk work. It is its own app and role because a
build would take cores from a live release, and because its login reaches
`recording_processing_jobs` alone: it can claim to have built media, but only the web's
capture port, under the row lock, can make a Recording ready. It:

1. Reads every attempt in order. A clean Egress left `full.mp4`. A crashed one did not,
   so its held segments are joined instead, and a segment missing ends that attempt.
   `p.m3u8` gives each attempt its real start time, and an attempt with no timed playlist
   has no honest place, so it is left out and becomes part of a gap.
2. Writes one whole video to `recordings/<id>/video.mp4`, the download. One clean attempt
   is that file, remuxed. Otherwise the attempts are joined with slate video for the real
   length of each gap, so the file states the gap too. Video time follows real time.
3. Builds 720p, 480p and 240p HLS from it under `recordings/<id>/hls/`, uploads
   everything, and verifies against the bucket: every playlist finished and full length,
   every segment present at its written size.
4. Reports `built`. The web turns that into `ready` with the speech timeline, or refuses
   it if the Recording was taken down or removed meanwhile.

A run counts when it is claimed, so one that kills its process spends an attempt like one
that throws, and only a shutdown gives its run back. A run that does not answer comes due
again after one minute, doubling to an hour, measured from its claim. Five runs end the
Recording as `failed` with `recording.processing_gave_up`, with `processing_failed` or
`verification_failed`. A run that dies holds a 60 second lease, renewed every 15; the next owner
repeats it to the same keys with a higher epoch, and the old owner can no longer write. Nothing
is discarded, and an operator can rebuild a ranked one. One slot uses every core
it can; add machines rather than slots. A build's scratch space is about three times the
video: `RECORDING_WORK_DIR` needs room for the longest Round times three.

### Sources

The job row opens as soon as an Egress is recorded, whatever the Recording's state, so one removed mid-capture still knows
what it left. The worker deletes `holdPrefix` once a Recording is `ready`, `removing` or
`removed` and no Broadcast or own Egress may still use it; a scheduled Broadcast can hold
them for hours. A Recording taken down keeps its sources, as evidence. A removal does not
end as `removed` until they are gone.

To find stuck work:

```sql
select recording_id, status, runs_started, due_at, lease_owner
from recording_processing_jobs where status <> 'settled' order by updated_at;
```

## What it needs to run

- A `recording-worker` app (`fly.recording-worker.toml`), its database login
  `daisy_recording_worker` (the operator creates the role before the merge, deploy-staging), and
  `RECORDING_WORKER_DATABASE_URL`.
- `RECORDING_HOLD_ENDPOINT`, `_BUCKET`, `_KEY` and `_SECRET`: a credential for the hold
  bucket that can read, list and delete. `RECORDING_BUCKET_*`: one that can write the
  Recording bucket.
- On the Recording bucket, CORS allowing `GET` from the app's origin. hls.js follows the
  playback route's redirect to a signed read, so without it the replay page cannot play in
  Chrome or Firefox. `RECORDING_BUCKET_ENDPOINT` must also be set on the web app, which is
  what names the bucket in the replay page's browser policy.

## States

`requested`, `capturing`, `processing`, `ready`, `failed`, `taken_down`, `removing`,
`removed`. `recordings.lifecycle` is the whole state; `status` repeats its tag.

A Broadcast an operator stopped before its watermark passed the Round's end still builds
its Recording, and the audience sees that video as held back (ISSUE-1094), recorded as
`broadcasts.media_withheld`. Seats and insiders can still watch it; releasing it to the
audience is an operator action not yet built. A feed that a takedown or a removal ended is
not withheld: the Recording's own state hides it.

## Preparation and delay

A running build writes how far it is on its job row, which the viewer and the Recording page
show. `recordingProcessingBoundMs` is half the media's length plus five minutes, from the
capture's end. Past it `recording.processing_delayed` is raised once, viewers are told it is
delayed, and it keeps retrying. Nothing is failed or discarded on a timer. Look at the
worker's capacity and queue.

`recording.processing_gave_up` means five runs did not produce a result and the Recording is `failed`. A casual
failure's partial objects are removed after seven days. A ranked one is never removed by a
sweep: it stays `failed`, with its hold cut down to whole segments committed history proved
public. Rebuild it from the admin app:
Content, then Failed ranked recordings, or the report's page. A rebuild goes back to
`processing` with its attempts counted afresh, and is refused if its sources are gone. A rebuild uses what stripping left: anything that was
unknown when it failed is gone even if history later proves it public, and shows as `not_public`.

`recording.build_ceiling_exceeded` means one run went past three times the bound. It was
stopped and counted as a failed attempt, and it retries. Nothing is discarded.

## Casual capture limits

A casual Launch with a broadcast or recording chosen is refused while its host already has two
running (`capture-host-limit`), or one runs fleet-wide (`capture-capacity`). Ranked is never
refused or counted. With one Egress machine, a casual Round holding it leaves a ranked Round
uncaptured, and the debate is untouched. Raise `CASUAL_CAPTURES_AT_ONCE` with the machines.

## Coverage

`media.gaps` states what the video shows as something other than the debate. Debate lost
is a capture restart (`capture_restart`), a room rotation (`room_rotation`), stated at an
estimated 5 seconds, and anything committed Round history neither proves public nor
explains (`not_public`, ADR 0099). The player lists these, and `media.unrecorded`, under
"Parts of this debate were not recorded". `media.unrecorded` is debate the video never
reached: a late start, an early end, or the rest of a Round whose Broadcast was stopped.
A private phase, which is the stage's slate (`private_phase`), is withheld by design, and
the player shows it on its own line as kept private. The slate between speeches
(`between_speeches`) holds no debate, and the player does not list it. It runs from one
speech's end into the next by the start-edge stamp lag plus 1.2 s, which is 2.5 s early in
a capture and about 3.6 s three hours in.

The worker marks a jump between public pieces `capture_restart` when one public interval
spans it, since only a restart explains that, and `not_public` otherwise. The capture port,
and the history page for a Recording already stored, split each `not_public` gap against
the Round's segments and prep (`explainGaps` in `coverage-statement.ts`). A Recording built before that split
shows correctly without a rebuild or a data change. A `not_public` gap on the list is a
real question: it is a stretch inside a speech that history does not prove public.

## Takedown

A takedown hides the Recording from everyone at once. Every new playback or download
request is refused, and a signed read already issued lasts at most 60 seconds. The
objects stay, as evidence for disputes and integrity review, until moderation
removes them: a moderation removal needs the takedown first, and only a legal ground removes
a Recording still up. A Recording taken down while ready can be restored as it was, and the audience
can watch it again. A takedown, a moderation removal and a legal removal each end the feed of
the Round's open Broadcast and withdraw it, and a restore does not start it again.
A ranked Round leaves the archive with its Recording, and the audience no longer gets its
transcript, captions or ballots on the timeline or the Recording page, though the result stands; a member seated in the Round still does. The reason is kept
on the Recording, from a closed list. A takedown just after a Broadcast completed withdraws its
feed at once rather than after the 60 second grace.

Take down, restore and delete are forms on a report's page in the admin app. Each names
the version the page read, so a Recording that changed since refuses the command and the
page must be read again.

## Evidence hold

Erasure of a seat or a participant's removal does not delete a casual Recording while a
report on it or its Round is open. It is hidden with its removal owed, cannot be
restored, and the deletion sweep moves it to `removing` when the report closes or 90 days
after the request, whichever is first. An ordinary moderation deletion is refused until the
report closes, and an old failed capture's cleanup waits for it. The one exception is "Remove for a legal reason": it needs a closed legal ground, which
goes on the admin audit chain, and it goes at once.

```sql
select id, lifecycle->'removalOwed' from recordings
where status = 'taken_down' and lifecycle ? 'removalOwed';
```

## Removal and erasure

A participant's removal of a casual Recording, an account's erasure outside an evidence
hold and a moderator's removal all write `removing`, a durable intent. The sweep runs every minute. It
lists the Recording's prefix, deletes a bounded batch, and marks it `removed` only when
the prefix lists empty, its sources are gone from the hold bucket, and at least an hour
has passed since the request, so a build still uploading cannot leave an object behind. Ranked Recordings cannot be
removed by a participant or by erasure.

Each of those removals, and a legal removal, also ends the feed of the
Round's open Broadcast in its own transaction, and asks a just-completed Broadcast's feed to go
at once. `stop_reason` says which: `recording_removed`, `recording_legally_removed`,
`recording_removed_by_participant` or `recording_removed_by_erasure`. None withholds the video,
and the Round itself carries on.

## When deletion is stuck

Look for rows that stay in `removing`:

```sql
select id, deletion_attempts, deletion_due_at
from recordings where status = 'removing' order by deletion_due_at;
```

A failed attempt reports `recording.deletion_failed`, doubles its wait, from one minute to at
most one hour, and keeps retrying. A removal requested over 24 hours ago reports
`recording.deletion_overdue` on every attempt until it ends. Alert on both. Fix the storage credentials or outage and the sweep catches up by itself.
Never edit `lifecycle` by hand to `removed`: the objects would stay in the bucket
with no intent left to delete them.

## Downloads

A subscriber gets a link signed for 60 seconds, ten per hour per account. A copy
already downloaded is outside Daisy and nothing here reaches it.
