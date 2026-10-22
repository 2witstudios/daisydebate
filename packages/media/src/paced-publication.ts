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
  readonly onAccepted?: (eligibleSamples: number) => void | Promise<void>;
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
async function writeFrame(
  input: PacedInput,
  original: Timeline,
  data: Int16Array,
  signal: AbortSignal,
  interval: number,
): Promise<Timeline | null> {
  if (signal.aborted || !original.valid) return null;
  const clock = await refresh(input, original, interval);
  if (!clock.valid) return null;
  const due =
    clock.anchorMs + (clock.eligibleSamples / input.sampleRate) * 1000 + 10;
  await input.waitUntilMs(due, signal);
  if (signal.aborted || input.nowMs() - due > 100) return null;
  const observed = observeSourceProgress(
    clock,
    await input.publication.capture10ms(data),
  );
  if (signal.aborted || !observed.window) return null;
  // Transport rounds outward; uncertainty is never narrowed to pass a floor.
  const window = {
    before: new Date(Math.floor(observed.window.beforeMs)).toISOString(),
    after: new Date(Math.ceil(observed.window.afterMs)).toISOString(),
  };
  if (!(await input.authorizeWindow(window)) || signal.aborted) return null;
  return observed.clock;
}
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
    for (let offset = 0; offset < data.length; offset += size) {
      const next = await writeFrame(
        input,
        clock,
        data.subarray(offset, offset + size),
        signal,
        interval,
      );
      if (!next) break;
      clock = next;
      eligibleSamples = next.eligibleSamples;
      await input.onAccepted?.(eligibleSamples);
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
