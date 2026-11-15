# Media pacing characterization

The deterministic replay beside `packages/media/src/audio-stream.test.ts`
characterizes the existing writer under known delayed scheduling. It does not
replace that file's strict `<60ms` wall-clock oracle. A passing replay cannot
waive a failing required gate.

Run from the repository root, with Bun 1.4.2 and one machine-wide heavy slot:

```sh
ls -la /tmp/daisy-heavy-slots
bun scripts/heavy.ts bun test packages/media/src/audio-stream-pacing.test.ts
```

The model drains its FIFO whenever injected time advances and explicitly drains
the final tail. Each frame is identifiable by its PCM value. Authority remains
an independently controlled unresolved promise until the writer and assertions
finish. The model tests:

- A `70ms` pacing deadline resumed `79.635583ms` late, normalized from the
  retained due `70.011209` / return `149.646792` observation. With zero lead,
  this exposes the modeled underrun and immediate ordered catch-up.
- A capture continuation delayed `86.025459ms` during initial 300ms lead fill,
  after seven frames. Only 70ms is queued; modeled underrun is `16.025459ms`.
- The same pacing lateness after 300ms lead is established in a one-second
  job. Reserve at return is `220.364417ms`, with no modeled underrun.
- Abort on late wake clears the reserve before another capture. A late wake
  after underrun accepts no frame whose modeled playout exceeds the cutoff.

Negative controls that replace absolute deadlines with relative waits or remove
cutoff enforcement must fail these assertions. Restoring the original writer
passes them. No pacing implementation correction follows from these modeled
results alone.

## Native observation

This manual diagnostic uses the existing loopback development SFU on port7880.
It creates synthetic rooms with fresh IDs and removes only its own rooms. It
requires the installed native rtc-node binding and SFU; missing infrastructure
fails, never skips. It needs no database, Redis, deployment or service reset.

```sh
ls -la /tmp/daisy-heavy-slots
DAISY_HEAVY_TIMEOUT_MINUTES=2 bun scripts/heavy.ts bun packages/media/integration/observe-pacing.ts
# Use the unique directory printed by that command:
bun scripts/heavy.ts bun packages/media/integration/analyze-pacing.ts /tmp/daisy-media-pacing-EXAMPLE
```

The observer uses actual 24kHz mono publication and subscription, a 500ms native
queue, a 300ms writer lead and a 1.5-second deterministic broadband signal. It
runs an on-time control, an initial-fill continuation delay, then an established
lead pacing delay. Only the writer continuation is delayed; the subscriber
continues reading. A private production `waitUntilMonotonic` is extracted
verbatim from `speaking.ts` into a temporary module, with only `export` added.
The module is removed afterward; source and adapter hashes, runtime and source
checkpoint are retained in `provenance.json`. This executes the production
timer body without starting the web application or introducing a second
production timer.

Per-frame traces distinguish pacing due/entry/return, native capture entry and
settle, delayed continuation entry/return, queue reserve and explicit final
queue drain. Raw source/subscriber PCM is signed 16-bit mono at24kHz. Receiver
sample offsets and callback timestamps are retained independently. Negotiated
codec metadata is retained where the native track reports it; the received PCM
has traversed encoding, transport, decoder and resampling.

Analysis matches 20ms broadband source windows at10ms strides to received
samples by normalized correlation. The first window is searched globally;
later windows search ±40ms around the preceding offset. It retains correlation,
source/received offsets, every lag jump over3ms, and per10ms RMS. These are
observations rather than a codec-independent continuity threshold. Large jumps
or poor matches require inspecting the raw data; the local search cannot prove
absence of a larger loss. Startup before the first aligned source content and
the deliberately captured 250ms tail are outside in-speech gap claims. PLC can
produce nonzero samples without preserving source content. Callback gaps,
aggregate energy, writer-reported `playedSamples`, and nominal queue capacity
alone establish neither interruption nor continuity.

The bounded 2026-11-15 observation found a20ms source-position insertion near a
controlled initial-fill delay with reserve reaching zero. Established reserve
remained above200ms and there was no corresponding insertion around that
controlled delay. Separate later lag shifts were also observed, so this is not
a whole-stream continuity PASS. The original failing real-time test used zero
lead, fake capture and a Bun.sleep loop; its native impact and scheduling root
cause remain unresolved. This diagnostic does not demonstrate a PR748-caused
regression or authorize changing ADR0122's guarantee.

The PageSpace plan `rzcdmefr6lijxawkktqyzgn7`, Delivery and Tab findings retain
exact commands, checkpoints, hashes and observed output. Original failure files
remain `/tmp/wiring-media-cadence-observation.json` and
`/tmp/wiring-source-result-checkpoint-affected.log`.
