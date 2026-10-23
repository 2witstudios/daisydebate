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
      anchorMs: frame.afterMs,
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
      clock = observed.clock;
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
