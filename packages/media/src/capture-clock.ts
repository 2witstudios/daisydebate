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

/** One native track and one monotonic clock origin. A rejected callback is never replayed. */
export function createCaptureClock(initial: ClockCalibration) {
  let calibration = initial;
  let clock: ReturnType<typeof publicationClock> | null = null;
  let previousSequence: number | null = null;
  const anchor = (frame: Observation) => {
    clock = publicationClock({
      calibration,
      anchorMs: frame.afterMs,
      sampleRate: 16000,
    });
    previousSequence = frame.sequence;
    return null;
  };
  return {
    observe(
      frame: Observation,
    ): { readonly beforeMs: number; readonly afterMs: number } | null {
      if (
        !Number.isSafeInteger(frame.sequence) ||
        frame.sequence < 0 ||
        !Number.isFinite(frame.beforeMs) ||
        !Number.isFinite(frame.afterMs) ||
        frame.afterMs < frame.beforeMs
      ) {
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
      return observed.window;
    },
    refresh(next: ClockCalibration) {
      calibration = next;
      if (clock) clock = refreshPublicationClock(clock, next);
    },
  };
}
