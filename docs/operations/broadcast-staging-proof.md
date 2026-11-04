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

## Private speech at the public edge

Twenty-two real Rounds on 2026-11-03, with a beep and a screen flash on a fixed grid
through every phase: ten that ran to their scheduled end, six where a speaker yielded,
and six with prep and a cross-examination. Each public feed was decoded and every beep
and flash placed against the Round's committed times. The rig ran a head before the
day's review fixes. Those change when a ranked result, a follower's notification and a
Recording's statement can leave, not how media is cut or released.

| Measure                               | Result                     |
| ------------------------------------- | -------------------------- |
| Private audio in the public feed      | 0 in all 22                |
| Private video in the public feed      | 0 in all 22                |
| Egress stamp offset, audio            | 87 to 815 ms, median 800   |
| Egress stamp offset, video            | 25 to 815 ms, median 759   |
| Lost at the start of the first speech | Median 3.0 s, 2 runs 21 s  |
| Lost at the start of a later segment  | 0.65 to 1.48 s, median 0.8 |
| Lost at the end of a segment          | 0.23 to 1.2 s, median 1.0  |

Twenty-two clean runs bound the leak rate; they do not make it zero. The margin carries
stamp offsets up to the ones above, so an offset beyond them is the case to watch.
The 21 s first-speech loss is the stage reaching air late on two runs, and the Recording
states it as a late start. Two prep runs carried one flash in a countdown, which is
neither public nor private and not a leak. The speech after prep was still open when its
run was measured, so its start and end loss are not in the table. Three casual
withdrawals were checked and each left no hold objects.

## At the smaller sizes

Egress and the Broadcast worker at performance-2x, the Recording worker at performance-1x, 3 Rounds, with nothing else on both LiveKit nodes. Staging ships these sizes.

| Measure                   | Result                                                    |
| ------------------------- | --------------------------------------------------------- |
| Private audio onsets      | 0, 0, 0                                                   |
| Private video             | 0, 0, 0                                                   |
| Spill past a speech's end | One, 51 ms into judging, from a beep that began in public |
| Egress offset, audio      | -643, -655, +651 ms                                       |
| Longest player stall      | 1, 0, 0 s                                                 |
| Dropped frames            | 11 of 3025, 0 of 2197, 0 of 4126                          |
| Peak CPU                  | Broadcast worker 49%, Egress 43%                          |

The same 3 Rounds at performance-4x had offsets of +81, +827 and +67 ms, and the same 3 on a warm Egress at the smaller size +683, +604 and +619 ms. The negative offsets have only been seen at the smaller size, and on a cold Egress; the cause is not found. Because of them, public speech stops 700 ms short of a prep's start. That margin has unit tests, and no Round has had a negative offset going into prep.

## The first Round after a boot

On a freshly booted Egress machine, Chrome's first launch took 15.0 s and its next 0.87 s, while GStreamer's registry took 1.1 s and fonts 21 ms. A first capture took 17 to 20 s, and viewers lost about 20 s of the first speech. Egress now launches Chrome once at boot, before its service starts. On that image, with this Round as the machine's first capture, request to `START_RECORDING` took 1.95 s and held media began 6.35 s before the first speech. One sample. What inside Chrome's first launch takes the time is not known.

## A Recording on the smaller recorder

A Round of about 6.8 minutes went from queued to ready in 7 minutes 46 s on performance-1x, with CPU at 100%: about 1.1 times real time, against 0.31 times at performance-4x. One short sample. At that rate an 80-minute Round would take about 90 minutes against its 45-minute bound.

## Audience polls beside a live debate

One run on 2026-11-03: a live public Round on the rig (performance-4x, 4 GB, with its
database, Redis and workers on the same machine), 5 minutes with no audience, then 5
minutes of `scripts/audience-load.ts` asking for 1,000 requests a second from one other
machine. Staging's web machine is smaller, shared-cpu-4x with 1 GB.

**Viewers did hurt the debate's supporting work at this load.** It reached 670 requests
a second and the web process saturated. All of it came from one address, so 186,513 of
the 200,913 requests were refused by the rate limit, and even those cost the process
enough to saturate it. Real viewers would each have their own address, and this run does
not say how their answered polls would compare.

| Measure                              | No audience | Under load |
| ------------------------------------ | ----------- | ---------- |
| Event loop delay, p50 of each second | 1 ms        | 272 ms     |
| Debate reads refused (competitive)   | 0           | 219        |
| Floor passes failed                  | 0 of 0      | 28 of 29   |
| Round maintenance passes failed      | 0           | 36         |
| Judging passes failed                | 0           | 14         |
| Broadcast reconcile passes failed    | 0           | 106        |
| Answered polls, p50                  | Not sent    | 5.9 s      |

The speech clock held: the one speech boundary inside the load window fell exactly on
schedule, 280 s after the last. No failure was logged in the 81 s after the load stopped. The Broadcast read
generation 2 after the run and the stage's own read had failed during it; this run does
not establish that the load caused the restart. It did not measure seats' audio or a
seat rejoining under load, and it was not rerun, so the rate where harm begins is unknown.

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
