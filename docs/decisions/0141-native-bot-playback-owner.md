# 0141: A native owner for the bot playback lifecycle

Status: accepted direction for design and prototype only (point guard
DEC-411, 2026-11-15), subject to owner confirmation or override. Runtime
integration and a delivery-contract correction are not accepted by this record.
Amends the implementation direction of
[ADR 0122](0122-authored-bot-speech.md); it does not waive its authority,
transcript, cutoff or required strict timing proofs.

## Context

The existing writer hands 10 ms PCM frames to a native source from a JavaScript
monotonic timer, with a 500 ms queue and 300 ms lead. An actual combined check
at `2a717d159febcf28377edd01e4f23d1f366e6451` failed the retained strict 60 ms
handoff oracle: an 82.284917 ms gap contained an 82.262542 ms pacing
wait/continuation interval, resuming 72.603542 ms after its due time. This
locates the interval; it does not identify timer dispatch, continuation,
runtime or OS cause, CPU/GC causality, or audible native impact.

The separate characterization in
[PR 752](https://github.com/2witstudios/daisydebate/pull/752) distinguishes
controlled initial-fill underrun from established reserve. Configured queue
capacity is not actual reserve. Its native control also has an unrelated
source-alignment shift, so it supplies no blanket continuity PASS. The
join-time authorization correction in
[PR 753](https://github.com/2witstudios/daisydebate/pull/753) is independent;
its actual combined affected gate remains red.

The pinned `@livekit/rtc-node` 1.2.0 / FFI 0.13.1 API exposes capture and
clear, without paused staging/readiness, generation cancellation or a native
absolute consumption deadline. A long captured frame is copied into a native
producer that submits queue-sized chunks; clearing the current buffer does
not fence its remaining producer. Bulk capture followed by clear is therefore
not an established substitute for the current abort/cutoff contract.

## Decision

1. **Design and prototype one native playback owner.** The narrow extension
   belongs at the pinned LiveKit FFI/source boundary. Rust is permitted only
   where that boundary requires it; this is the explicit exception to the
   repository's no-new-Rust rule for this prototype. No distributed service,
   database authority, new product policy or runtime deployment is authorized.
2. **Stage without consumption.** Immutable, authorized PCM is owned by one
   generation. A native readiness acknowledgement attests accepted data and
   the actual paused source's playable reserve. A configured capacity or a
   JavaScript drain estimate is not readiness. No stage operation credits a
   line or means audio was heard.
3. **Start one generation explicitly.** A generation-bound command arms the
   ready source. Its first actual consumption has a native monotonic witness.
   Calibrate that instant conservatively against the existing database clock.
   Old starts, stages or producer work cannot revive a cancelled generation.
4. **Keep authority and reveal semantics.** Existing application/database
   checks authorize every whole phrase before audio. Reveal remains beside
   audio at its actual start; this record does not add a requirement to wait
   for a reveal commit before first audio. A refusal cancels the matching
   generation. Never pre-credit or expose unsaid complete text, treat staged
   samples as consumed, or grant native code database/floor authority.
   For prototype design/proof, DEC-412 accepts ordered processing of a
   generation-bound first-consumption witness and terminal receipt when
   cancellation races before the witness reaches JavaScript: reveal only
   actually started audio, preserve every existing claim/floor/close refusal,
   then account for its consumed interruption. Zero-consumed cancellation
   never reveals. Response loss uses idempotent reveal/close semantics;
   model success is no real database/native race proof.
5. **Own cancellation and cutoff at consumption.** A native calibrated
   deadline prevents a frame whose source interval ends past cutoff.
   Generation cancellation fences and joins producers and any current sink
   emission before acknowledging. A later old callback must not refill or
   emit PCM. Receipt counts identify source-consumed samples and first/last
   source instants; they are not a claim of subscriber hearing. Interrupted
   word credit still comes from what played, and completion still requires
   successful reveal and the source tail's completion.
6. **Review races and assumptions before integration.** Specify the complete
   state machine, start-versus-cancel, first-sample-versus-delayed-reveal,
   refusal, response-loss and terminal accounting races. State and measure
   bounds for native scheduling, bridge/command dispatch and synchronous
   sink work. An arbitrary OS/process suspension is not an unconditional
   physical real-time guarantee. A JavaScript worker timer or a larger queue
   is not proof of the missing lifecycle contract.
7. **Preserve the blocking evidence.** The existing strict 60 ms oracle,
   original red artifacts and parent hold remain in force until a separately
   explicit, evidence-grounded contract correction. This record authorizes
   neither a relaxed oracle nor a parent push, merge or deployment. The
   independent join-request correction may continue its own review.

## Proof before runtime adoption

A deterministic native-owner model must discriminate paused startup, stale
starts and stages, cancellation while a sink/producer is in flight, no
refill after cancellation acknowledgement, late initial/established cutoff,
PCM order and exact source-consumed receipts. Negative controls must fail.
A stand-alone Rust model proves its transitions, not the LiveKit ABI,
real-time scheduling, native reserve, database operation or subscriber output.

Integration additionally requires actual 24 kHz mono source/receiver proof at
the intended queue/lead, measured paused readiness and first consumption,
real reveal/refusal/response-loss races, cancellation during outstanding
native work, and source cutoff/receipt checks. Correlate native playhead and
aligned received PCM; distinguish startup/tail, codec uncertainty, already
emitted network audio and in-speech gaps. Existing authority/cutoff tests and
the required combined affected gate remain required. No runtime adoption
follows from a model or isolated pass alone.

## Sources and scope

- [DEC-412](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/pe54r9ih6s82pp7si644bayn) for prototype race direction.
- [DEC-411](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/ayiouxdfdzorqynqs5ikplao),
  after [DEC-410](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/lm9q7zu8sfrykwt5iq4eh8w3).
- [Plan and retained evidence](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/pe9rojpbtu1aike8ihk45vkn).
- [Pinned Node AudioSource](https://github.com/livekit/node-sdks/blob/31d9d7e306e6c70c2eb748efde5afbded95a170e/packages/livekit-rtc/src/audio_source.ts),
  byte-identical to the installed audio source file; repository patches affect
  other SDK surfaces.
- [Pinned native chunk producer](https://github.com/livekit/rust-sdks/blob/7187f6a42ca6382b73c631b75a9d560253f5b90f/libwebrtc/src/native/audio_source.rs)
  and [source consumption/clear](https://github.com/livekit/rust-sdks/blob/7187f6a42ca6382b73c631b75a9d560253f5b90f/webrtc-sys/src/audio_track.cpp).
  Source inspection establishes API feasibility and a refill risk; it is not
  binary equivalence or native reproduction proof.

This is a documentation decision for the prototype boundary. It does not
complete media runtime implementation tasks or change production behavior.
