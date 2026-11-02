import {
  CAPTURE_COVERAGE_TOLERANCE,
  type CaptureGap,
  type CapturePartialReason,
  type CaptureVerdict,
} from '@daisy/protocol';

export type CaptureInterval = {
  readonly start: number;
  readonly end: number | null;
};
/** How far an authority window's capture may start late and end early. */
export type CoverageEdges = {
  /** Its first stretch, before speech began: the speaker has not yet heard the grant (DEC-218). */
  readonly openMs: number;
  /** Its last stretch, after speech ended: a yield reaches the server late (DEC-220). */
  readonly closeMs: number;
  /**
   * The last stretch before the authority's terminal close, for a bot's
   * credited windows only (DEC-212, ISSUE-806): the speaker cannot see the
   * cutoff, so its last windows may open after its final frame. A human's
   * grants have none, so a microphone that dies before a final grant still
   * seals partial.
   */
  readonly terminalCloseMs?: number;
};
type Range = CaptureGap;
export type StreamCoverage = {
  readonly authority: readonly CaptureInterval[];
  readonly tolerance: CoverageEdges;
};

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

type CaptureFacts = {
  readonly interrupted?: boolean;
  /** The sealing process held frames it then had to drop. */
  readonly framesLost?: boolean;
  readonly epoch: number;
  readonly observations: readonly {
    readonly start: number;
    readonly end: number;
    readonly epoch: number;
  }[];
  readonly chunks:
    { readonly count: number; readonly otherEpochChunks: number } | undefined;
  readonly storedChunks: number;
  readonly expectedChunks: number;
  /** A bot's grant it did not use: with no evidence of speech, nothing was owed. */
  readonly grantUnused?: boolean;
} & StreamCoverage;

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
  const { problem, gaps } = traverseCoverage({
    authority: facts.authority,
    tolerance: facts.tolerance,
    observed: facts.observations,
  });
  if (nothingOwed(facts)) return { state: 'complete', gaps: [] };
  const [first, ...rest] = [
    ...evidenceReasons(facts),
    ...(problem ? [problem] : []),
  ];
  return first
    ? { state: 'partial', reasons: [first, ...rest], gaps }
    : { state: 'complete', gaps: [] };
}

/** One rule for one tolerance, handed to the adapter as data it cannot change. */
export function createCaptureRule(tolerance: {
  readonly joinMs: number;
  readonly relayMs: number;
}) {
  return {
    decideStreamCapture,
    /** Where a closed stream's required speech has no capture. */
    gaps: (coverage: StreamCoverage, observed: readonly CaptureInterval[]) =>
      traverseCoverage({ ...coverage, observed }).gaps,
    /**
     * What a seat's stream must cover and how far its edges may move (DEC-218,
     * DEC-220): a human's speaking grants; a bot's credited publication windows.
     * Silence outside a bot's windows is not speech.
     */
    coverage(
      kind: 'human' | 'bot',
      grants: readonly CaptureInterval[],
      botWindows: readonly Range[],
    ): StreamCoverage {
      if (kind !== 'bot')
        return {
          authority: grants,
          tolerance: { openMs: tolerance.joinMs, closeMs: tolerance.relayMs },
        };
      return {
        authority: botWindows,
        tolerance: {
          openMs: tolerance.relayMs,
          closeMs: tolerance.relayMs,
          // Only credited windows end at a cutoff the speaker cannot see (ISSUE-806).
          terminalCloseMs: tolerance.relayMs,
        },
      };
    },
  };
}
export type CaptureRule = ReturnType<typeof createCaptureRule>;
export const captureRule = createCaptureRule(CAPTURE_COVERAGE_TOLERANCE);
