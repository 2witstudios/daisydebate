import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';

type Segment = {
  readonly id: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
  readonly durationMs: number;
};
type Interval = {
  readonly segmentId: string;
  readonly roundParticipantId: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
};
type Frame = {
  readonly pcm: Int16Array;
  readonly trackId: string;
  readonly nominalStartMs: number;
  readonly beforeMs: number;
  readonly afterMs: number;
};
type Input = {
  readonly roundId: string;
  readonly roundParticipantId: string;
  readonly segments: readonly Segment[];
  readonly intervals: readonly Interval[];
  readonly frames: readonly Frame[];
  readonly serverNowMs: number;
};
type Admitted = {
  readonly frame: Frame;
  readonly segment: Segment;
  readonly interval: number;
};
const invalid = () =>
  createAppError('VALIDATION', 'Invalid calibrated capture batch');
const instant = (n: number) =>
  Number.isSafeInteger(n) && Math.abs(n) <= 8640000000000000;
const endValid = (start: number, end: number | null) =>
  end === null || (instant(end) && end >= start);
const segmentValid = (s: Segment) =>
  idSchema.safeParse(s.id).success &&
  instant(s.startedAtMs) &&
  Number.isSafeInteger(s.durationMs) &&
  s.durationMs > 0 &&
  instant(s.startedAtMs + s.durationMs) &&
  endValid(s.startedAtMs, s.endedAtMs);
const intervalValid = (i: Interval) =>
  idSchema.safeParse(i.segmentId).success &&
  idSchema.safeParse(i.roundParticipantId).success &&
  instant(i.startedAtMs) &&
  endValid(i.startedAtMs, i.endedAtMs);
const frameValid = (f: Frame) =>
  f.pcm instanceof Int16Array &&
  f.pcm.length === 160 &&
  f.trackId.length > 0 &&
  f.trackId.length <= 128 &&
  [f.nominalStartMs, f.beforeMs, f.afterMs].every(instant) &&
  f.beforeMs <= f.nominalStartMs &&
  f.afterMs >= f.nominalStartMs + 10;
function validate(input: Input) {
  if (
    !idSchema.safeParse(input.roundId).success ||
    !idSchema.safeParse(input.roundParticipantId).success ||
    !instant(input.serverNowMs) ||
    input.frames.length > 12000 ||
    !input.segments.every(segmentValid) ||
    !input.intervals.every(intervalValid) ||
    !input.frames.every(frameValid)
  )
    throw invalid();
}
function admit(input: Input, frame: Frame): Admitted | null {
  if (frame.afterMs > input.serverNowMs) return null;
  const matches = input.intervals.flatMap((grant, interval) => {
    if (
      grant.roundParticipantId !== input.roundParticipantId ||
      grant.startedAtMs > frame.beforeMs ||
      (grant.endedAtMs !== null && frame.afterMs >= grant.endedAtMs)
    )
      return [];
    const segment = input.segments.find((s) => s.id === grant.segmentId);
    if (
      !segment ||
      segment.startedAtMs > frame.beforeMs ||
      frame.afterMs >=
        Math.min(
          segment.endedAtMs ?? Infinity,
          segment.startedAtMs + segment.durationMs,
        )
    )
      return [];
    return [{ frame, segment, interval }];
  });
  // Ambiguous history never chooses an arbitrary granting segment.
  return matches.length === 1 ? matches[0]! : null;
}
function wav(frames: readonly Admitted[]) {
  const bytes = new Uint8Array(44 + frames.length * 320);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) =>
    bytes.set(new TextEncoder().encode(value), offset);
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, bytes.length - 44, true);
  let offset = 44;
  for (const { frame } of frames)
    for (const value of frame.pcm) {
      view.setInt16(offset, value, true);
      offset += 2;
    }
  return bytes;
}
function clip(input: Input, frames: readonly Admitted[]) {
  const first = frames[0]!;
  const startOffsetMs = first.frame.nominalStartMs - first.segment.startedAtMs;
  return {
    roundId: input.roundId,
    segmentId: first.segment.id,
    roundParticipantId: input.roundParticipantId,
    trackId: first.frame.trackId,
    startOffsetMs,
    durationMs: frames.length * 10,
    before: new Date(
      Math.min(...frames.map((f) => f.frame.beforeMs)),
    ).toISOString(),
    after: new Date(
      Math.max(...frames.map((f) => f.frame.afterMs)),
    ).toISOString(),
    clipKey: new Bun.CryptoHasher('sha3-256')
      .update(
        JSON.stringify([
          input.roundId,
          first.segment.id,
          input.roundParticipantId,
          first.frame.trackId,
          startOffsetMs,
        ]),
      )
      .digest('hex'),
    wav: wav(frames),
  };
}
function cutAt(frames: readonly Admitted[]) {
  let latest = 6000;
  for (let index = 5499; index < 6000; index++) {
    const pcm = frames[index]!.frame.pcm;
    const rms = Math.sqrt(
      pcm.reduce((sum, value) => sum + value * value, 0) / pcm.length,
    );
    if (rms <= 64) latest = index + 1;
  }
  return latest;
}

/** Consumes already calibrated frames and committed history; raw native callbacks are not eligibility. */
export function cutCaptureClips(input: Input) {
  validate(input);
  const clips: ReturnType<typeof clip>[] = [];
  let pending: Admitted[] = [];
  let droppedFrames = 0;
  let lastNominal = -Infinity;
  const flush = () => {
    if (pending.length) clips.push(clip(input, pending));
    pending = [];
  };
  for (const frame of input.frames) {
    const current =
        frame.nominalStartMs < lastNominal + 10 ? null : admit(input, frame),
      previous = pending.at(-1);
    lastNominal = Math.max(lastNominal, frame.nominalStartMs);
    if (!current) {
      droppedFrames++;
      flush();
      continue;
    }
    if (
      previous &&
      (current.interval !== previous.interval ||
        current.frame.trackId !== previous.frame.trackId ||
        current.frame.nominalStartMs !== previous.frame.nominalStartMs + 10)
    )
      flush();
    pending.push(current);
    if (pending.length === 6000) {
      const at = cutAt(pending);
      clips.push(clip(input, pending.slice(0, at)));
      pending = pending.slice(at);
    }
  }
  flush();
  return { clips, droppedFrames };
}
