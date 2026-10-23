import {
  publicationClock,
  observeSourceProgress,
  refreshPublicationClock,
  type ClockCalibration,
} from './publication-clock';

type Observation = {
  readonly sequence: number;
  readonly beforeMs: number;
  readonly afterMs: number;
};

/**
 * How far below its callback a run anchors (ISSUE-485). Native capture
 * callbacks are paced 10 ms apart with a little jitter, so anchoring exactly at
 * a late callback's bracket would refuse every steady frame after it; half a
 * frame of tolerance absorbs jitter while a queued frame, a whole period early,
 * is still refused. The tolerance only widens bounds downward.
 */
const ANCHOR_TOLERANCE_MS = 5;

const wellFormed = (frame: Observation) =>
  Number.isSafeInteger(frame.sequence) &&
  frame.sequence >= 0 &&
  Number.isFinite(frame.beforeMs) &&
  Number.isFinite(frame.afterMs) &&
  frame.afterMs >= frame.beforeMs;

/**
 * One native track and one monotonic clock origin. A rejected callback is
 * never replayed. Each contiguous run anchors its nominal timeline once, at
 * its first frame's lower bound, and advances exactly 10 ms per received
 * frame: a calibration refresh tightens the bracket but never moves a frame,
 * and only a real gap starts a new run (ISSUE-466-r4).
 */
export function createCaptureClock(initial: ClockCalibration) {
  let calibration = initial;
  let clock: ReturnType<typeof publicationClock> | null = null;
  let previousSequence: number | null = null;
  let runStartMs: number | null = null;
  let runFrames = 0;
  const anchor = (frame: Observation) => {
    runStartMs = null;
    runFrames = 0;
    clock = publicationClock({
      calibration,
      anchorMs: Math.max(
        frame.afterMs - ANCHOR_TOLERANCE_MS,
        calibration.receivedAtMs,
      ),
      sampleRate: 16000,
    });
    previousSequence = frame.sequence;
    return null;
  };
  return {
    observe(frame: Observation): {
      readonly beforeMs: number;
      readonly afterMs: number;
      readonly nominalStartMs: number;
    } | null {
      if (!wellFormed(frame)) {
        clock = null;
        previousSequence = null;
        return null;
      }
      if (
        !clock ||
        previousSequence === null ||
        frame.sequence !== previousSequence + 1
      )
        return anchor(frame);
      const observed = observeSourceProgress(clock, {
        startSample: clock.eligibleSamples,
        endSample: clock.eligibleSamples + 160,
        beforeMs: frame.beforeMs,
        afterMs: frame.afterMs,
      });
      if (!observed.window) return anchor(frame);
      // A slightly fast source walks the anchor down, keeping the tolerance below
      // its earliest paced callback; a burst arrives too early to walk.
      clock = {
        ...observed.clock,
        anchorMs: Math.min(
          observed.clock.anchorMs,
          frame.beforeMs -
            ANCHOR_TOLERANCE_MS -
            (observed.clock.eligibleSamples / observed.clock.sampleRate) * 1000,
        ),
      };
      previousSequence = frame.sequence;
      runStartMs ??= Math.ceil(observed.window.beforeMs);
      return {
        ...observed.window,
        nominalStartMs: runStartMs + 10 * runFrames++,
      };
    },
    refresh(next: ClockCalibration) {
      calibration = next;
      if (clock) clock = refreshPublicationClock(clock, next);
    },
  };
}
