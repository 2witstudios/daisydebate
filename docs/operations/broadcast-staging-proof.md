# Broadcast staging proof

What was measured on staging for the Watch release, and what each result does
not show. All of it ran on Fly in `ord`, and the load clients also in `iad`,
against real LiveKit, Web Egress and Tigris, between 2026-11-02 and 2026-11-03.
The app, its database and the workers ran on one rig machine built from the PR
branch, not on the deployed staging app. The rig scripts are not committed, so
these runs cannot be repeated from this repository as they stand.

## Viewer load

Two concurrent Broadcasts, 2,500 viewers in each of two regions, 5,000 in total.
These clients fetched manifests and segments as a player does; they were not real
browsers, so they measure delivery and not rebuffering.

| Measure                       | Result                                        |
| ----------------------------- | --------------------------------------------- |
| Worker lag                    | Max 66 s; none over the 90 s bound            |
| Release failures              | 0                                             |
| Manifest p95 by region        | 10 ms and 19 ms; max 283 ms and 959 ms        |
| Segment p95 by region         | 75 ms and 61 ms; max 7.8 s and 4.8 s          |
| Segment gone after a takedown | 10 s after the manifests                      |
| Delivery cost                 | $0.0009 per viewer-hour at $0.0005 per 1k GET |

Tigris carried this with no CDN in front, so the release has no CDN.

## Real players

Eight real browsers on one machine in one region played at 720p, starting in about
1.3 s, with no stalls in about 6,500 viewer-seconds sampled once a second. Seek p95
was about 2 s. Eight viewers in one region say little about rebuffering at scale.

An iOS 26 Simulator reached a first frame through native HLS on the page, and the
feed played in Safari's own player. The page's play button on a real iPhone and on
macOS Safari is not proven here.

## Faults

- **Egress crash:** restarted within 30 s; a player stalled 23 s and resumed.
- **Revocation failure, injected through a fault proxy:** the Egress stopped and
  restarted, as designed.
- **Reconnect during revocation:** a stale token stayed subscribed for at most
  0.5 s, and the stage's reconnect was refused.

## A real Round beside Broadcast and Recording

Two browsers spoke synthesized speech through the real Round room, with the capture
worker and the real AI judge. One Round also ran Broadcast and Recording, and a
control Round ran neither. Each was seven segments of about 48 s.

| Measure                      | With both | Control  |
| ---------------------------- | --------- | -------- |
| Seat streams complete        | 9 of 9    | 9 of 9   |
| Transcript freeze            | Complete  | Complete |
| Observed audio               | 427 s     | 428 s    |
| Words captured               | 1,147     | 1,140    |
| Mean overlap with own script | 0.999     | 0.999    |
| Judge attempts               | 1         | 1        |

This is one Round each, so it shows no visible effect and not the absence of one.
Overlap is the share of transcript words found in that speaker's script, not a word
error rate. The judge chose different winners on the two runs (ISSUE-1223).

The same rig also proved three things in a third Round. Every seat signed in through
the real form and emailed link, with mail captured rather than delivered. A human
ballot through the browser form set the outcome. A visitor's browser played the
Recording from its own bucket with no failed requests.

## Takedown with no free slot

With the worker's only release slot held by a live Round, a stopped feed's public
objects answered 404 between 1.3 s and 2.1 s after the stop, and the live Broadcast
kept releasing. This covers Broadcast objects, not Recording objects. The seeded
feed had four objects, so a long feed takes longer: deletes run 32 at a time.

## Bucket keys

Checked each way on 2026-11-03. A visitor is refused listing all three buckets, and
reading a hold object directly (403). The Recording key cannot list the hold bucket.
Neither the hold key nor the public key can list the Recording bucket. The public key
cannot list the hold bucket. The Recording key can write only its own bucket. Both
the Recording key and the hold key can list the public bucket, which is ISSUE-1222.
