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
 * The instant from which the terminal zone is forgiven, or null: speech
 * ended there when a capture run carrying credited speech reaches into it.
 */
function terminalZone(
  windows: readonly Range[],
  runs: readonly Range[],
  terminalCloseMs: number | undefined,
): number | null {
  if (terminalCloseMs === undefined) return null;
  const from = Math.max(...windows.map((w) => w.end)) - terminalCloseMs;
  return runs.some(
    (run) => run.end >= from && windows.some((w) => overlaps(run, w)),
  )
    ? from
    : null;
}

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
 * what stops the coverage being whole. For a bot, once capture of its credited
 * speech reaches the terminal zone, nothing in that fixed zone is required
 * (ISSUE-806), so more captured evidence near the cutoff never turns complete
 * into partial (ISSUE-807). Coverage is producer evidence, independent of
 * transcript text or lease ownership.
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
  const terminal = terminalZone(windows, runs, tolerance.terminalCloseMs);
  return windows.flatMap((w) =>
    uncovered(
      {
        start: speechBegan(w, runs, tolerance.openMs),
        end: Math.min(
          speechEnded(w, runs, tolerance.closeMs),
          terminal ?? Infinity,
        ),
      },
      runs,
    ),
  );
}

const nothingOwed = (facts: CaptureFacts) =>
  facts.grantUnused === true &&
  !facts.interrupted &&
  !facts.framesLost &&
  facts.observations.length === 0 &&
  facts.chunks?.count === 0 &&
  facts.chunks.otherEpochChunks === 0 &&
  facts.storedChunks === 0 &&
  facts.expectedChunks === 0;

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
  if (nothingOwed(facts)) return { state: 'complete', gaps: [] };
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

/**
 * A bot's credited windows separated by less than relay latency are one window
 * for coverage (DEC-294): a publisher stall must not create a tiny window that
 * has to hold a frame. A real hole stays, and still fails contiguity.
 */
function coalesceCreditedWindows(
  windows: readonly Range[],
  relayMs: number,
): Range[] {
  const merged: Range[] = [];
  for (const window of [...windows].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && window.start - last.end < relayMs)
      merged[merged.length - 1] = {
        start: last.start,
        end: Math.max(last.end, window.end),
      };
    else merged.push(window);
  }
  return merged;
}

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
    coverage: (kind, grants, botWindows) =>
      kind === 'bot'
        ? {
            authority: coalesceCreditedWindows(botWindows, tolerance.relayMs),
            tolerance: {
              openMs: tolerance.relayMs,
              closeMs: tolerance.relayMs,
              // Only credited windows end at a cutoff the speaker cannot see (ISSUE-806).
              terminalCloseMs: tolerance.relayMs,
            },
          }
        : {
            authority: grants,
            tolerance: { openMs: tolerance.joinMs, closeMs: tolerance.relayMs },
          },
  };
}
export const captureRule = createCaptureRule(CAPTURE_COVERAGE_TOLERANCE);
