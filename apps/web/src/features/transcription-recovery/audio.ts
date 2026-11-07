import {
  canonicalCaptureEvidenceBody,
  type CaptureEvidenceBody,
} from '@daisy/protocol';
import { verifyFrameClockEvidence } from '@daisy/media/observation';
import { encodePcmWave } from '@daisy/media/pcm';
const runOf = (body: CaptureEvidenceBody) =>
  JSON.stringify([
    body.roundId,
    body.sessionId,
    body.workerId,
    body.epoch,
    body.segmentId,
    body.roundParticipantId,
    body.trackId,
    body.intervalId,
    body.segmentStartedAtMs,
    body.frames[0]!.clock.anchor,
  ]);
/** Encoding of already-authenticated originals only. This supplies neither current dispatch authority nor hearing/coverage/quality proof. */
export function assembleOriginalAudio(input: {
  readonly roundId: string;
  readonly evidenceIds: readonly string[];
  readonly bodies: readonly unknown[];
}) {
  const refused = { kind: 'refused' as const };
  if (
    input.evidenceIds.length < 1 ||
    input.evidenceIds.length > 128 ||
    new Set(input.evidenceIds).size !== input.evidenceIds.length ||
    input.bodies.length !== input.evidenceIds.length
  )
    return refused;
  const bodies: CaptureEvidenceBody[] = [];
  let durationMs = 0;
  for (const [index, raw] of input.bodies.entries()) {
    const encoded = canonicalCaptureEvidenceBody(raw);
    if (encoded.kind !== 'encoded') return refused;
    const body = encoded.body;
    if (
      body.roundId !== input.roundId ||
      body.evidenceId !== input.evidenceIds[index] ||
      !body.frames.every((frame) => verifyFrameClockEvidence(frame.clock))
    )
      return refused;
    durationMs += body.durationMs;
    if (durationMs > 30000) return refused;
    const previous = bodies.at(-1);
    if (previous) {
      const last = previous.frames.at(-1)!.clock,
        first = body.frames[0]!.clock;
      if (
        runOf(previous) !== runOf(body) ||
        previous.startOffsetMs + previous.durationMs !== body.startOffsetMs ||
        first.observation.sequence !== last.observation.sequence + 1 ||
        first.previous?.sequence !== last.observation.sequence ||
        first.previous.nominalStartMs !== last.window.nominalStartMs ||
        first.window.nominalStartMs !== last.window.nominalStartMs + 10
      )
        return refused;
    }
    bodies.push(body);
  }
  const frames: Int16Array[] = [];
  try {
    for (const body of bodies)
      for (const frame of body.frames) {
        const bytes = Buffer.from(frame.pcmS16le, 'base64');
        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        );
        const samples = new Int16Array(160);
        try {
          for (let index = 0; index < 160; index += 1)
            samples[index] = view.getInt16(index * 2, true);
        } finally {
          bytes.fill(0);
        }
        frames.push(samples);
      }
    return {
      kind: 'assembled' as const,
      wav: encodePcmWave(frames),
      durationMs,
    };
  } finally {
    for (const frame of frames) frame.fill(0);
  }
}
