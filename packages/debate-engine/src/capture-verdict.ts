import { botGrantUnused } from './bot-grant';
import {
  CAPTURE_COVERAGE_TOLERANCE,
  type CaptureFacts,
  type CaptureGap,
  type CaptureInterval,
  type CapturePartialReason,
  type CaptureRule,
  type CaptureVerdict,
  type CoverageEdges,
  type StreamCoverage,
} from '@daisy/protocol';

type Range = CaptureGap;

const validRange = (range: CaptureInterval): range is Range =>
  Number.isFinite(range.start) &&
  range.end !== null &&
  Number.isFinite(range.end) &&
  range.end >= range.start;

/** Contiguous capture: overlapping or touching observations merged, in order. */
function captureRuns(observed: readonly Range[]): Range[] {
  const runs: Range[] = [];
  for (const { start, end } of [...observed].sort(
    (a, b) => a.start - b.start,
  )) {
    const last = runs.at(-1);
    if (last && start <= last.end)
      runs[runs.length - 1] = {
        start: last.start,
        end: Math.max(last.end, end),
      };
    else runs.push({ start, end });
  }
  return runs;
}

const overlaps = (a: Range, b: Range) => a.start < b.end && a.end > b.start;

/**
 * Where speech began in a window: the first capture run inside its open zone,
 * else its opening, so a dead microphone stays partial (DEC-218).
 */
function speechBegan(w: Range, runs: readonly Range[], openMs: number) {
  const run = runs.find(
    (r) => r.end > w.start && r.start <= w.start + openMs && r.start < w.end,
  );
  return run ? Math.max(w.start, run.start) : w.start;
}

/**
 * Where speech ended in a window: the end of the last capture run reaching
 * into its close zone, never past the window, else its close (DEC-220). A run
 * that starts after the window, such as a capture restart, never moves it.
 */
function speechEnded(w: Range, runs: readonly Range[], closeMs: number) {
  const run = runs
    .filter(
      (r) => r.start < w.end && r.end > w.start && r.end >= w.end - closeMs,
    )
    .at(-1);
  return run ? Math.min(w.end, run.end) : w.end;
}

/** The parts of `range` no capture run reaches, in order. */
function uncovered(range: Range, runs: readonly Range[]): Range[] {
  const gaps: Range[] = [];
  let at = range.start;
  for (const run of runs) {
    if (run.end <= at) continue;
    if (run.start >= range.end) break;
    if (run.start > at) gaps.push({ start: at, end: run.start });
    at = Math.max(at, run.end);
  }
  if (at < range.end) gaps.push({ start: at, end: range.end });
  return gaps;
}

/**
 * The one traversal of a stream's required speech: where it has no capture, and
 * what stops the coverage being whole. Coverage is producer evidence,
 * independent of transcript text or lease ownership.
 */
function traverseCoverage({
  authority,
  observed,
  tolerance,
}: StreamCoverage & { readonly observed: readonly CaptureInterval[] }): {
  readonly problem: CapturePartialReason | null;
  readonly gaps: readonly Range[];
} {
  const windows = authority.filter(validRange).filter((w) => w.end > w.start);
  const validObserved = observed.filter(validRange);
  const gaps = windows.length
    ? gapsOf(windows, captureRuns(validObserved), tolerance)
    : [];
  const invalid = !authority.every(validRange) || !observed.every(validRange);
  const problem = invalid
    ? 'invalid-history'
    : !windows.length
      ? 'no-authority-window'
      : gaps.length
        ? 'coverage-gap'
        : null;
  return { problem, gaps };
}

function gapsOf(
  windows: readonly Range[],
  runs: readonly Range[],
  tolerance: CoverageEdges,
) {
  return windows.flatMap((w) =>
    uncovered(
      {
        start: speechBegan(w, runs, tolerance.openMs),
        end: speechEnded(w, runs, tolerance.closeMs),
      },
      runs,
    ),
  );
}

const chunksCounted = ({
  chunks,
  storedChunks,
  expectedChunks,
}: CaptureFacts) =>
  chunks !== undefined &&
  Number.isSafeInteger(storedChunks) &&
  storedChunks >= 0 &&
  storedChunks === expectedChunks &&
  storedChunks === chunks.count;

/** What stops a stream's evidence being this epoch's own and fully counted. */
const evidenceReasons = (facts: CaptureFacts): CapturePartialReason[] => [
  ...(facts.interrupted ? (['session-interrupted'] as const) : []),
  ...(facts.framesLost ? (['frames-lost'] as const) : []),
  ...((facts.chunks?.otherEpochChunks ?? 0) > 0 ||
  facts.observations.some((row) => row.epoch !== facts.epoch)
    ? (['other-worker-evidence'] as const)
    : []),
  ...(chunksCounted(facts) ? [] : (['chunks-uncounted'] as const)),
];

/**
 * Complete only with this epoch's own evidence, every stored chunk counted and
 * full coverage of the authority windows (DEC-218); a new worker cannot recover
 * old PCM. State, gaps and reasons all come from this one decision.
 */
export function decideStreamCapture(facts: CaptureFacts): CaptureVerdict {
  const { problem, gaps } = traverseCoverage({
    authority: facts.authority,
    tolerance: facts.tolerance,
    observed: facts.observations,
  });
  const [first, ...rest] = [
    ...evidenceReasons(facts),
    ...(problem ? [problem] : []),
  ];
  return first
    ? { state: 'partial', reasons: [first, ...rest], gaps }
    : { state: 'complete', gaps: [] };
}

/** Below one audio packet, a measured gap is the measure's own grain. */
const STATED_GAP_MIN_MS = 20;

/** One rule for one tolerance, handed to the adapter as data it cannot change. */
export function createCaptureRule(tolerance: {
  readonly joinMs: number;
  readonly relayMs: number;
}): CaptureRule {
  return {
    decideStreamCapture,
    botGrantUnused,
    gaps: (coverage, observed) =>
      traverseCoverage({ ...coverage, observed }).gaps,
    edges: (coverage, observed) => {
      const runs = captureRuns(observed.filter(validRange));
      const tolerated = traverseCoverage({ ...coverage, observed }).gaps;
      return coverage.authority
        .filter(validRange)
        .flatMap((window) => uncovered(window, runs))
        .filter(
          (gap) =>
            gap.end - gap.start >= STATED_GAP_MIN_MS &&
            !tolerated.some((other) => overlaps(gap, other)),
        );
    },
    coverage: (grants) => ({
      authority: grants,
      tolerance: { openMs: tolerance.joinMs, closeMs: tolerance.relayMs },
    }),
  };
}
export const captureRule = createCaptureRule(CAPTURE_COVERAGE_TOLERANCE);
