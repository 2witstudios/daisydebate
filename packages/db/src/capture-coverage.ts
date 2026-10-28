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
type Range = { readonly start: number; readonly end: number };

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
const covers = (runs: readonly Range[], { start, end }: Range) =>
  end <= start || runs.some((run) => run.start <= start && run.end >= end);

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
 * Whether every authority window, a human's speaking grant or a bot's credited
 * publication window, is captured (DEC-218): one contiguous capture run from
 * where speech began until it reaches into the close zone, where speech ended
 * (DEC-220), and at least one frame inside the window, so a dead microphone
 * stays partial however short the window. For a bot, once capture of its
 * credited speech reaches the terminal zone, nothing in that zone is required
 * (ISSUE-806). The close and terminal zones are fixed, so more captured
 * evidence near the cutoff never turns complete into partial (ISSUE-807).
 * Coverage is producer evidence, independent of transcript text or lease
 * ownership.
 */
export function hasCompleteCaptureCoverage(input: {
  readonly authority: readonly CaptureInterval[];
  readonly observed: readonly CaptureInterval[];
  readonly tolerance: CoverageEdges;
  readonly storedChunks: number;
  readonly expectedChunks: number;
}): boolean {
  const { authority, observed, tolerance } = input;
  if (
    !Number.isSafeInteger(input.storedChunks) ||
    input.storedChunks < 0 ||
    input.storedChunks !== input.expectedChunks ||
    !authority.every(validRange) ||
    !observed.every(validRange)
  )
    return false;
  const windows = authority.filter((w) => w.end > w.start);
  if (!windows.length) return false;
  const runs = captureRuns(observed);
  const terminal = terminalZone(windows, runs, tolerance.terminalCloseMs);
  return windows.every((w) => {
    const forgivenFrom = Math.min(
      w.end - tolerance.closeMs,
      terminal ?? Infinity,
    );
    const required = {
      start: speechBegan(w, runs, tolerance.openMs),
      end: forgivenFrom,
    };
    const framed =
      (terminal !== null && w.start >= terminal) ||
      runs.some((run) => overlaps(run, w));
    return framed && covers(runs, required);
  });
}
