import { createAppError } from '@daisy/errors';
import type { createAudioPublication } from './audio-publication';
import {
  observeSourceProgress,
  publicationClock,
  refreshPublicationClock,
  type ClockCalibration,
} from './publication-clock';

type Publication = Awaited<ReturnType<typeof createAudioPublication>>;

type PacedInput = {
  readonly publication: Publication;
  readonly sampleRate: number;
  readonly channels: number;
  readonly nowMs: () => number;
  readonly waitUntilMs: (dueMs: number, signal: AbortSignal) => Promise<void>;
  readonly calibrate: () => Promise<ClockCalibration>;
  readonly authorizeWindow: (window: {
    readonly before: string;
    readonly after: string;
  }) => Promise<boolean>;
  readonly refreshAfterMs?: number;
  /**
   * Frames authorized together as one union window. A union inside the
   * speaking interval proves every frame in it; a bot may be heard up to this
   * many frames past its end before the refusal lands, audibly only, since
   * capture credit is bounded by the interval itself (DEC-212).
   */
  readonly framesPerAuthorization: number;
  /** The segment end on the database clock, when known: unions are clamped to it. */
  readonly segmentEndsAtMs?: number;
  readonly onAccepted?: (eligibleSamples: number) => void | Promise<void>;
  /**
   * Samples per channel handed to the native source so far, reported after
   * each frame is sent and before its window is authorized: a frame is heard
   * first and credited after, so a resume continues past it.
   */
  readonly onSent?: (sentSamples: number) => void;
};

function validateJob(input: PacedInput, data: Int16Array) {
  if (
    !(data instanceof Int16Array) ||
    ![24000, 48000].includes(input.sampleRate) ||
    ![1, 2].includes(input.channels) ||
    data.length === 0 ||
    data.length % ((input.sampleRate / 100) * input.channels) !== 0 ||
    data.length > input.sampleRate * input.channels * 60
  )
    throw createAppError('VALIDATION', 'Unsupported PCM publication job');
}
const refreshInterval = (input: PacedInput) => {
  const value = input.refreshAfterMs ?? 15000;
  if (!Number.isFinite(value) || value <= 0 || value > 15000)
    throw createAppError('VALIDATION', 'Invalid calibration refresh interval');
  return value;
};
type Timeline = ReturnType<typeof publicationClock>;
async function refresh(input: PacedInput, clock: Timeline, interval: number) {
  return input.nowMs() - clock.calibration.receivedAtMs >= interval
    ? refreshPublicationClock(clock, await input.calibrate())
    : clock;
}
/** Sends one frame and reports it sent before its window is judged. */
async function captureFrame(
  input: PacedInput,
  clock: Timeline,
  data: Int16Array,
) {
  const receipt = await input.publication.capture10ms(data);
  input.onSent?.(clock.eligibleSamples + data.length / input.channels);
  return observeSourceProgress(clock, receipt);
}
async function writeFrame(
  input: PacedInput,
  original: Timeline,
  data: Int16Array,
  signal: AbortSignal,
  interval: number,
): Promise<{ clock: Timeline; window: FrameWindow } | null> {
  if (signal.aborted || !original.valid) return null;
  const clock = await refresh(input, original, interval);
  if (!clock.valid) return null;
  const due =
    clock.anchorMs + (clock.eligibleSamples / input.sampleRate) * 1000 + 10;
  await input.waitUntilMs(due, signal);
  if (signal.aborted || input.nowMs() - due > 100) return null;
  const observed = await captureFrame(input, clock, data);
  if (signal.aborted || !observed.window) return null;
  return { clock: observed.clock, window: observed.window };
}
type FrameWindow = { readonly beforeMs: number; readonly afterMs: number };
const union = (pending: FrameWindow | null, next: FrameWindow) =>
  pending === null
    ? next
    : {
        beforeMs: Math.min(pending.beforeMs, next.beforeMs),
        afterMs: Math.max(pending.afterMs, next.afterMs),
      };
/** Authorizes a batch's union, clamped to a known segment end. */
async function authorizeUnion(
  input: PacedInput,
  pending: FrameWindow,
  signal: AbortSignal,
) {
  const afterMs = Math.min(
    pending.afterMs,
    (input.segmentEndsAtMs ?? Infinity) - 1,
  );
  if (afterMs <= pending.beforeMs) return false;
  // Transport rounds outward. The clamp lowers only the union's end to the
  // known segment end, and frames heard past it are never credited.
  const allowed = await input.authorizeWindow({
    before: new Date(Math.floor(pending.beforeMs)).toISOString(),
    after: new Date(Math.ceil(afterMs)).toISOString(),
  });
  return allowed && !signal.aborted;
}
/** Frames sent since the last authorization, as one union window. */
function createBatch(input: PacedInput, signal: AbortSignal) {
  let pending: FrameWindow | null = null;
  let frames: { readonly afterMs: number; readonly samples: number }[] = [];
  let credited = 0;
  const endMs = input.segmentEndsAtMs ?? Infinity;
  return {
    /** Adds a sent frame and the samples sent through it; true when the batch is due. */
    add(window: FrameWindow, samples: number, last: boolean) {
      pending = union(pending, window);
      frames.push({ afterMs: window.afterMs, samples });
      return last || frames.length === input.framesPerAuthorization;
    },
    /**
     * The samples credited through this batch, or null when refused. A frame
     * heard past the known end is audible only, never eligible (ISSUE-460-r2);
     * its end is rounded outward, as the transport rounds it (ISSUE-460-r3).
     */
    async authorize() {
      const due = pending!,
        sent = frames;
      pending = null;
      frames = [];
      if (!(await authorizeUnion(input, due, signal))) return null;
      credited =
        sent.filter((frame) => Math.ceil(frame.afterMs) < endMs).at(-1)
          ?.samples ?? credited;
      return credited;
    },
  };
}
const pastSegmentEnd = (input: PacedInput, window: FrameWindow) =>
  input.segmentEndsAtMs !== undefined &&
  window.afterMs >= input.segmentEndsAtMs;
async function writeJob(
  input: PacedInput,
  data: Int16Array,
  signal: AbortSignal,
) {
  validateJob(input, data);
  const interval = refreshInterval(input);
  let eligibleSamples = 0;
  try {
    let clock = publicationClock({
      calibration: await input.calibrate(),
      anchorMs: input.nowMs(),
      sampleRate: input.sampleRate,
    });
    const size = (input.sampleRate / 100) * input.channels;
    const batch = createBatch(input, signal);
    for (let offset = 0; offset < data.length; offset += size) {
      const next = await writeFrame(
        input,
        clock,
        data.subarray(offset, offset + size),
        signal,
        interval,
      );
      if (!next) break;
      clock = next.clock;
      const due = batch.add(
        next.window,
        clock.eligibleSamples,
        offset + size >= data.length,
      );
      if (!due) continue;
      const credited = await batch.authorize();
      if (credited === null) break;
      eligibleSamples = credited;
      await input.onAccepted?.(eligibleSamples);
      if (pastSegmentEnd(input, next.window)) break;
    }
  } catch (error) {
    if (!signal.aborted) throw error;
  }
  return {
    eligibleSamples,
    complete:
      !signal.aborted && eligibleSamples * input.channels === data.length,
  };
}

/** One cancellable PCM job. Raw handoffs cannot bypass cadence or authority. */
export function createPacedAudioWriter(input: PacedInput) {
  const batch = input.framesPerAuthorization;
  if (!Number.isSafeInteger(batch) || batch < 1 || batch > 10)
    throw createAppError('VALIDATION', 'Invalid authorization batch');
  let used = false;
  return async (data: Int16Array, signal: AbortSignal) => {
    if (used)
      throw createAppError('CONFLICT', 'A publication job cannot be reused');
    used = true;
    try {
      return await writeJob(input, data, signal);
    } finally {
      await input.publication.close();
    }
  };
}
