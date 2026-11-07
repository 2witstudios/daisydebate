import type {
  ClockCalibration,
  FrameObservation,
  FrameRunAnchor,
  FrameClockEvidence,
} from '@daisy/protocol';
import { calibrationOffsets, publicationClock } from './publication-clock';
import { frameClockEvidenceSchema } from '@daisy/protocol';

type Run = {
  readonly anchor: FrameRunAnchor;
  readonly sequence: number;
  readonly nominalStartMs: number;
  /** Server-time lower bound of the run's first frame start. */
  readonly lowerMs: number;
  /** Server-time upper bound of the run's first frame end. */
  readonly upperMs: number;
};

const wellFormed = (frame: FrameObservation) =>
  Number.isSafeInteger(frame.sequence) &&
  frame.sequence >= 0 &&
  Number.isFinite(frame.beforeMs) &&
  Number.isFinite(frame.afterMs) &&
  frame.afterMs >= frame.beforeMs;

/** Whether a calibration may map a callback observed at `atMs` onto server time. */
const usable = (calibration: ClockCalibration, atMs: number) =>
  publicationClock({ calibration, anchorMs: atMs, sampleRate: 16000 }).valid &&
  atMs - calibration.receivedAtMs <= 30000;

function mapFrameRun(
  calibration: ClockCalibration,
  frame: FrameObservation,
  last: FrameRunAnchor['previous'],
): Run | null {
  if (!usable(calibration, frame.afterMs)) return null;
  const offsets = calibrationOffsets(
    calibration,
    frame.beforeMs - 10,
    frame.afterMs,
  );
  const lowerMs = frame.beforeMs - 10 + offsets.lower;
  return {
    anchor: {
      calibration: { ...calibration },
      observation: { ...frame },
      previous: last ? { ...last } : null,
    },
    sequence: frame.sequence,
    nominalStartMs: !last
      ? Math.ceil(lowerMs)
      : frame.sequence > last.sequence
        ? last.nominalStartMs + (frame.sequence - last.sequence) * 10
        : // A counter reset is a new native stream: place it by the clock, never contiguous.
          Math.max(Math.ceil(lowerMs), last.nominalStartMs + 20),
    lowerMs,
    upperMs: frame.afterMs + offsets.upper,
  };
}

function frameRunWindow(run: Run, sequence: number) {
  const elapsedMs = (sequence - run.sequence) * 10;
  const driftMs = (elapsedMs + 10) * 0.0001;
  const nominalStartMs = run.nominalStartMs + elapsedMs;
  return {
    nominalStartMs,
    beforeMs: Math.min(run.lowerMs + elapsedMs - driftMs, nominalStartMs),
    afterMs: Math.max(run.upperMs + elapsedMs + driftMs, nominalStartMs + 10),
  };
}

/**
 * One native track's server-time timeline (DEC-215), for every role that reads audio. Gaps are decided by frame
 * sequence, never by clock: contiguous sequence numbers advance exactly 10 ms
 * whatever their arrival timing, and each missing one is exactly a 10 ms gap.
 * The track's first run takes its nominal start from the calibration (its first
 * frame's 10 ms period ends at its callback); every later run continues the
 * track's sequence, so no clock shift can shrink or close a gap. A counter that
 * goes backwards is a new native stream on the same track: its run is placed
 * by the calibration, at least one frame after the last, never contiguously
 * (ISSUE-466-r7). The
 * calibration maps each run onto server time once, at its first frame, and a
 * refresh never moves a run. Each frame's bracket is that mapping advanced by
 * its sequence and widened by 100 ppm drift, joined with its nominal span, so
 * it always contains the span. A rejected callback is never replayed.
 */
export function createFrameClock(initial: ClockCalibration) {
  let calibration = { ...initial };
  let observed: FrameClockEvidence | null = null;
  let run: Run | null = null;
  let last: {
    readonly sequence: number;
    readonly nominalStartMs: number;
  } | null = null;
  return {
    observe({ sequence, beforeMs, afterMs }: FrameObservation): {
      readonly beforeMs: number;
      readonly afterMs: number;
      readonly nominalStartMs: number;
    } | null {
      // Native callbacks also carry PCM and identity; clock provenance owns only these facts.
      const frame = { sequence, beforeMs, afterMs };
      observed = null;
      const previous = last ? { ...last } : null;
      if (!wellFormed(frame)) {
        run = null;
        return null;
      }
      if (!run || !last || frame.sequence !== last.sequence + 1)
        run = mapFrameRun(calibration, frame, last);
      if (!run) return null;
      const window = frameRunWindow(run, frame.sequence);
      last = {
        sequence: frame.sequence,
        nominalStartMs: window.nominalStartMs,
      };
      observed = {
        observation: { ...frame },
        anchor: run.anchor,
        previous,
        window: { ...window },
      };
      return window;
    },
    /** Immutable original mapping input only; this does not prove admission or sequence continuity. */
    evidence(): FrameClockEvidence | null {
      return observed ? structuredClone(observed) : null;
    },
    /** The calibration the next run maps with; a running run never moves. */
    refresh(next: ClockCalibration) {
      calibration = { ...next };
    },
  };
}

/**
 * One frame clock per native track, as every role that reads audio times
 * frames (capture, bot listening): a track's first frame starts its clock on
 * the current calibration, refreshes reach every clock, and a closed track's
 * clock goes. Each window is rounded outward to whole milliseconds.
 */
export function createTrackClocks() {
  const clocks = new Map<string, ReturnType<typeof createFrameClock>>();
  return {
    observe(
      frame: FrameObservation & { readonly trackId: string },
      calibration: ClockCalibration,
    ) {
      let clock = clocks.get(frame.trackId);
      if (!clock) {
        clock = createFrameClock(calibration);
        clocks.set(frame.trackId, clock);
      }
      const window = clock.observe(frame);
      return window
        ? {
            beforeMs: Math.floor(window.beforeMs),
            afterMs: Math.ceil(window.afterMs),
            nominalStartMs: window.nominalStartMs,
          }
        : null;
    },
    evidence(trackId: string): FrameClockEvidence | null {
      return clocks.get(trackId)?.evidence() ?? null;
    },
    refresh(calibration: ClockCalibration) {
      for (const clock of clocks.values()) clock.refresh(calibration);
    },
    close(trackId: string) {
      clocks.delete(trackId);
    },
    clear() {
      clocks.clear();
    },
  };
}

/** Validates original mapping equations only; this grants neither authority nor cross-run continuity. */
export function verifyFrameClockEvidence(input: unknown): boolean {
  const parsed = frameClockEvidenceSchema.safeParse(input);
  if (!parsed.success) return false;
  const evidence = parsed.data;
  const { anchor, observation, previous } = evidence;
  const run = mapFrameRun(
    anchor.calibration,
    anchor.observation,
    anchor.previous,
  );
  if (!run) return false;
  if (
    observation.sequence === anchor.observation.sequence &&
    (observation.beforeMs !== anchor.observation.beforeMs ||
      observation.afterMs !== anchor.observation.afterMs)
  )
    return false;
  const expectedPrevious =
    observation.sequence === anchor.observation.sequence
      ? anchor.previous
      : {
          sequence: observation.sequence - 1,
          nominalStartMs:
            run.nominalStartMs + (observation.sequence - 1 - run.sequence) * 10,
        };
  if (
    previous?.sequence !== expectedPrevious?.sequence ||
    previous?.nominalStartMs !== expectedPrevious?.nominalStartMs
  )
    return false;
  const expected = frameRunWindow(run, observation.sequence);
  return [expected.beforeMs, expected.afterMs, expected.nominalStartMs].every(
    Number.isFinite,
  )
    ? expected.nominalStartMs === evidence.window.nominalStartMs &&
        expected.beforeMs === evidence.window.beforeMs &&
        expected.afterMs === evidence.window.afterMs
    : false;
}
