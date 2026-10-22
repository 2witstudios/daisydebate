# Native audio publication timing

The Bun adapter uses `@livekit/rtc-node` 1.2.0 and its prebuilt FFI 0.13.1
under ADR 0053 and ADR 0067. Versioned official source links are in
[the dependency registry](../dependencies.md#round-media-vendor-adapter).
`AudioSource(..., queueSize = 0)` accepts exactly 10ms frames. Its native
fast path calls the source sinks synchronously before the capture completion
callback. The adapter records monotonic time immediately before dispatch and
after that callback. The acknowledged sample prefix is raw source handoff
progress, never browser delivery, drain duration or eligible transcript credit.

`@daisy/media/audio` exports `createAudioPublication`;
`@daisy/media/publication` exports `createPacedAudioWriter`. Each writer owns one
PCM job and closes its publication on completion, rejection or cancellation.
The worker must inject its monotonic clock, cancellable cadence wait, database
clock calibration and fresh historical eligibility reader. Native source output
is not a promise of audibility or remote playback.

## Conservative clock mapping

A calibration brackets a fresh database timestamp D between monotonic sends m0
and receives m1. Reject negative RTT or RTT above 100ms. The initial server offset
interval is [D-m1, D-m0+p], where p is the timestamp quantization uncertainty
(1ms for the database ISO representation). Refresh at most every 15 seconds;
receipts or refreshes older than 30 seconds are rejected. A refreshed interval
must intersect the previous interval widened by 100ppm drift. A discontinuity
invalidates the existing publication anchor; calibration cannot revive a gap.

For acknowledged prefix n at sample rate r, the next nominal period starts at
s = anchor + 1000*n/r and ends at s+10ms. Dispatch waits for that end. Reject an
early dispatch, noncontiguous sample count, non-10ms frame, reversed native
bracket or acknowledgement later than the due time plus 100ms. For acknowledgement
time a and calibration receive m1, use drift d = 0.0001*max(a-m1, abs(s-m1)).
The full uncertainty window is [s+D-m1-d, a+D-m0+p+d], rounded outward to ISO
milliseconds. This covers the nominal frame and native handoff bracket, including
a frame beginning before a refreshed calibration. It is not a point timestamp.

Every full nonempty window must pass the committed historical speaking reader.
Only then does the eligible prefix advance. A stalled acknowledgement can
increase raw source progress while granting zero additional eligible credit.
After any gap or lost authority the job stops; it cannot re-anchor and later
credit that raw prefix. Cancellation is checked before dispatch, after native
acknowledgement and after authorization, and prevents queued future frames.
No audio failure decides a competitive result.

## Reproducible evidence and remaining integration

The real integration suite is
`packages/media/integration/native-publication.integration.ts`. Run it through
`bun scripts/heavy.ts bun --env-file=.env run --cwd packages/media test:integration integration/native-publication.integration.ts`
after `bun slot:up`. It uses the loopback LiveKit 1.13.7 service, actual native
publication/subscription and isolated PostgreSQL history. It proves a paced
200ms job with refreshed calibration, nonzero received PCM, and burst, stalled
callback, historical closure and cancellation controls. Subscriber sample totals
only corroborate transport; authorization uses the native source brackets.

Two source sabotage controls were observed: disabling raw prefix advancement
fails the expected 9600-sample native assertion; removing early-dispatch rejection
makes the burst control reach the real historical reader with an invalid window
and fail. Unit tests separately reject excessive RTT, stale/discontinuous clocks,
and prove conservative drift across refreshed calibration.

This foundation does not establish provider PCM support, worker capture/sealing,
lease fencing, durable append/freeze races, browser media, teardown recovery or
CI service availability. Those remain delivery obligations. Worker composition
must also isolate SDK logging through Daisy's privacy-aware adapters before
production use. No production service, credentials or deployment is activated.
