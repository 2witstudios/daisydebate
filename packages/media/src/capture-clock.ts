import {
  calibrationOffsets,
  publicationClock,
  type ClockCalibration,
} from './publication-clock';

type Observation = {
  readonly sequence: number;
  readonly beforeMs: number;
  readonly afterMs: number;
};
type Run = {
  readonly sequence: number;
  readonly nominalStartMs: number;
  /** Server-time lower bound of the run's first frame start. */
  readonly lowerMs: number;
  /** Server-time upper bound of the run's first frame end. */
  readonly upperMs: number;
};

const wellFormed = (frame: Observation) =>
  Number.isSafeInteger(frame.sequence) &&
  frame.sequence >= 0 &&
  Number.isFinite(frame.beforeMs) &&
  Number.isFinite(frame.afterMs) &&
  frame.afterMs >= frame.beforeMs;

/** Whether a calibration may map a callback observed at `atMs` onto server time. */
const usable = (calibration: ClockCalibration, atMs: number) =>
  publicationClock({ calibration, anchorMs: atMs, sampleRate: 16000 }).valid &&
  atMs - calibration.receivedAtMs <= 30000;

/**
 * One native track's capture timeline (DEC-215). Gaps are decided by frame
 * sequence, never by clock: contiguous sequence numbers advance exactly 10 ms
 * whatever their arrival timing, and each missing one is exactly a 10 ms gap.
 * The track's first run takes its nominal start from the calibration (its first
 * frame's 10 ms period ends at its callback); every later run continues the
 * track's sequence, so no clock shift can shrink or close a gap. The
 * calibration maps each run onto server time once, at its first frame, and a
 * refresh never moves a run. Each frame's bracket is that mapping advanced by
 * its sequence and widened by 100 ppm drift, joined with its nominal span, so
 * it always contains the span. A rejected callback is never replayed.
 */
export function createCaptureClock(initial: ClockCalibration) {
  let calibration = initial;
  let run: Run | null = null;
  let last: {
    readonly sequence: number;
    readonly nominalStartMs: number;
  } | null = null;
  const map = (frame: Observation): Run | null => {
    if (!usable(calibration, frame.afterMs)) return null;
    const offsets = calibrationOffsets(
      calibration,
      frame.beforeMs - 10,
      frame.afterMs,
    );
    const lowerMs = frame.beforeMs - 10 + offsets.lower;
    return {
      sequence: frame.sequence,
      nominalStartMs: last
        ? last.nominalStartMs + Math.max(frame.sequence - last.sequence, 1) * 10
        : Math.ceil(lowerMs),
      lowerMs,
      upperMs: frame.afterMs + offsets.upper,
    };
  };
  return {
    observe(frame: Observation): {
      readonly beforeMs: number;
      readonly afterMs: number;
      readonly nominalStartMs: number;
    } | null {
      if (!wellFormed(frame)) {
        run = null;
        return null;
      }
      if (!run || !last || frame.sequence !== last.sequence + 1)
        run = map(frame);
      if (!run) return null;
      const elapsedMs = (frame.sequence - run.sequence) * 10;
      const driftMs = (elapsedMs + 10) * 0.0001;
      const nominalStartMs = run.nominalStartMs + elapsedMs;
      last = { sequence: frame.sequence, nominalStartMs };
      return {
        nominalStartMs,
        beforeMs: Math.min(run.lowerMs + elapsedMs - driftMs, nominalStartMs),
        afterMs: Math.max(
          run.upperMs + elapsedMs + driftMs,
          nominalStartMs + 10,
        ),
      };
    },
    /** The calibration the next run maps with; a running run never moves. */
    refresh(next: ClockCalibration) {
      calibration = next;
    },
  };
}
