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
type Admitted = {
  readonly frame: Frame;
  readonly segment: Segment;
  /** The one granting interval, by identity: history is reread per batch. */
  readonly grant: string;
};
/**
 * One stream's admitted frames not yet cut into a clip, carried by the caller
 * from one batch to the next: a clip ends at a pause, the sixty-second bound,
 * a split, or the final flush, never at a batch boundary (VIDEO-4.1-r7).
 */
export type ClipCarry = {
  readonly frames: readonly Admitted[];
  readonly lastNominal: number;
};
type Input = {
  readonly roundId: string;
  readonly roundParticipantId: string;
  readonly segments: readonly Segment[];
  readonly intervals: readonly Interval[];
  readonly frames: readonly Frame[];
  readonly serverNowMs: number;
  /** The previous batch's carry for this stream; none for its first. */
  readonly carry?: ClipCarry | null;
  /** The stream's segment has ended or it seals: flush what remains. */
  readonly final: boolean;
};
/** At most sixty seconds of 10 ms frames per clip. */
const MAX_CLIP_FRAMES = 6000;
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
const carryValid = (carry: Input['carry']) =>
  carry == null ||
  (carry.frames.length < MAX_CLIP_FRAMES &&
    carry.frames.every(({ frame }) => frameValid(frame)));
function validate(input: Input) {
  if (
    !idSchema.safeParse(input.roundId).success ||
    !idSchema.safeParse(input.roundParticipantId).success ||
    !instant(input.serverNowMs) ||
    input.frames.length > 12000 ||
    !input.segments.every(segmentValid) ||
    !input.intervals.every(intervalValid) ||
    !input.frames.every(frameValid) ||
    !carryValid(input.carry)
  )
    throw invalid();
}
function admit(input: Input, frame: Frame): Admitted | null {
  if (frame.afterMs > input.serverNowMs) return null;
  const matches = input.intervals.flatMap((grant) => {
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
    const key = JSON.stringify([
      grant.segmentId,
      grant.roundParticipantId,
      grant.startedAtMs,
    ]);
    return [{ frame, segment, grant: key }];
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
/** Low energy: an observed PCM RMS at most 64 signed sample units. */
const lowEnergy = (pcm: Int16Array) =>
  Math.sqrt(pcm.reduce((sum, value) => sum + value * value, 0) / pcm.length) <=
  64;
/** A pause this long (500 ms) after speech ends its clip. */
const PAUSE_FRAMES = 50;
/** Low-energy frames ending `frames`, and whether any frame before them is speech. */
function trailingQuiet(frames: readonly Admitted[]) {
  let quiet = 0;
  while (
    quiet < frames.length &&
    lowEnergy(frames[frames.length - 1 - quiet]!.frame.pcm)
  )
    quiet++;
  return { quiet, heard: quiet < frames.length };
}
function cutAt(frames: readonly Admitted[]) {
  let latest = MAX_CLIP_FRAMES;
  for (let index = 5499; index < MAX_CLIP_FRAMES; index++)
    if (lowEnergy(frames[index]!.frame.pcm)) latest = index + 1;
  return latest;
}

/** Two admitted frames continue one clip: same grant and track, the next 10 ms. */
const continues = (previous: Admitted, current: Admitted) =>
  current.grant === previous.grant &&
  current.frame.trackId === previous.frame.trackId &&
  current.frame.nominalStartMs === previous.frame.nominalStartMs + 10;

/** One stream's open clip: accumulates admitted frames and cuts at a pause or the bound. */
function openClip(input: Input, carried: readonly Admitted[]) {
  const clips: ReturnType<typeof clip>[] = [];
  let pending = [...carried];
  let { quiet, heard } = trailingQuiet(pending);
  const flush = () => {
    if (pending.length) clips.push(clip(input, pending));
    pending = [];
    quiet = 0;
    heard = false;
  };
  const push = (current: Admitted) => {
    const previous = pending.at(-1);
    if (previous && !continues(previous, current)) flush();
    pending.push(current);
    if (lowEnergy(current.frame.pcm)) quiet++;
    else [quiet, heard] = [0, true];
    // Speech then a full pause ends the clip; silence alone keeps accumulating.
    if (heard && quiet >= PAUSE_FRAMES) flush();
    else if (pending.length === MAX_CLIP_FRAMES) {
      const at = cutAt(pending);
      clips.push(clip(input, pending.slice(0, at)));
      pending = pending.slice(at);
      ({ quiet, heard } = trailingQuiet(pending));
    }
  };
  return { clips, push, flush, pending: () => pending };
}

/**
 * Consumes already calibrated frames and committed history; raw native
 * callbacks are not eligibility. Frames not yet cut return as the carry for
 * the stream's next batch.
 */
export function cutCaptureClips(input: Input) {
  validate(input);
  const open = openClip(input, input.carry?.frames ?? []);
  let droppedFrames = 0;
  let lastNominal = input.carry?.lastNominal ?? -Infinity;
  for (const frame of input.frames) {
    const current =
      frame.nominalStartMs < lastNominal + 10 ? null : admit(input, frame);
    lastNominal = Math.max(lastNominal, frame.nominalStartMs);
    if (current) open.push(current);
    else {
      droppedFrames++;
      open.flush();
    }
  }
  if (input.final) open.flush();
  return {
    clips: open.clips,
    droppedFrames,
    carry: input.final ? null : { frames: open.pending(), lastNominal },
  };
}
