# Native audio publication

The Bun adapter uses `@livekit/rtc-node` 1.2.0 and its prebuilt FFI 0.13.1
under ADR 0053 and ADR 0067. Versioned official source links are in
[the dependency registry](../dependencies.md#round-media-vendor-adapter).
Only bot seats publish natively; people publish from the browser.

`@daisy/media/audio` exports `createAudioPublication`. It joins the Room,
publishes one microphone track and feeds it from an `AudioSource` with a real
native queue (`queueMs`, 500 ms by default), which plays out in real time. A
10 ms handoff settles at once while the queue has room. `queuedMs` reads what
is handed over but not yet played, and `clearQueue` drops it at once, so a
stop or a barge-in is silent immediately. A failed handoff or a dropped
connection makes the publication unusable; `close` leaves the Room without
unpublishing first (ISSUE-789).

`@daisy/media/publication` exports `createStreamingAudioWriter`, a plain
real-time writer ([ADR 0122](../decisions/0122-authored-bot-speech.md)). It
hands each 10 ms frame over on a monotonic schedule, `leadMs` ahead of its
playout, starting after whatever is already queued, so consecutive phrases
play back to back. It awaits nothing but the clock and the handoff: no
authority check or database call can stall the stream. It returns the samples
sent and the samples played: an abort clears the queue and counts the queued
samples as unplayed. With `stopAtMs` it never hands over a frame whose playout
would end after that instant, on schedule or after an underrun. A failed
handoff stops the stream and reports the failure with the played prefix.
Native source output is not a promise of remote playback.

## Reproducible evidence

The real integration suite is
`packages/media/integration/native-publication.integration.ts`. Run it through
`bun scripts/heavy.ts bun --env-file=.env run --cwd packages/media test:integration integration/native-publication.integration.ts`
after `bun slot:up`. Against the loopback LiveKit service it proves a whole
job streamed in real time to a real subscriber while a concurrent 200 ms
stall goes unawaited, and an abort that clears the native queue and counts
only the audio that played. Unit tests (`audio-stream.test.ts`) pin the
schedule, the lead, the hard stop, queue-aware scheduling and failed
handoffs on a fake clock.

The calibration helpers in `publication-clock.ts` (`publicationClock`,
`calibrationOffsets`) remain only for the frame clock that times received
audio (`@daisy/media/observation`).

## Native receive callback foundation

`createAudioSubscription` uses the same pinned rtc-node1.2.0 public
AudioStream FrameProcessor extension, with16kHz mono160-sample frames. The SDK
invokes that processor synchronously in its FFI frameReceived handler before
its readable controller enqueues the frame. The adapter copies PCM and records
an injected monotonic before/after bracket in that callback. Its asynchronous
reader pump discards queued transport frames and never assigns timestamps.
Per-track sequence is raw callback progress, not coverage or eligible duration.

Only explicitly mapped opaque debater identities and microphone publications
receive processors. Unpublish, participant/room disconnect, removed identity or
callback failure closes the stream. The public closed promise reports connection
closure; a closed subscription cannot rescan stale native handles. This is the
single hidden capture subscriber; bot clients need no additional subscription
for activity heuristics. Actual consumer mapping must bind Round/session/seat and
lease epoch, preserve native sequence/brackets, calibrate server time and mark
unknown/gap on stale, discontinuous or uncertain input. Monotonic clocks from
different processes are not interchangeable.

Real Bun/LiveKit tests receive nonzero16kHz mono PCM, demonstrate processor
callbacks while no readable reader exists, and verify stream closure on actual
unpublish and actual room deletion. That establishes the raw receive primitive,
not complete grant coverage, clipping, STT, bot barge-in relay or publication
credit. SDK default logs still require isolation/suppression at the worker edge;
this foundation does not claim production logging acceptance.
