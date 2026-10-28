export type CaptureInterval = {
  readonly start: number;
  readonly end: number | null;
};
/** How far a required interval's opening and close may move to captured frames. */
export type CoverageEdges = {
  readonly openMs: number;
  readonly closeMs: number;
  /**
   * The tolerance at the authority's terminal close, for a bot's credited
   * windows only (DEC-212, ISSUE-806). A human's grants have none, so a
   * microphone that dies before a final grant still seals partial.
   */
  readonly terminalCloseMs?: number;
};
const validRange = ({ start, end }: CaptureInterval) =>
  Number.isFinite(start) &&
  end !== null &&
  Number.isFinite(end) &&
  end >= start;

function covered(
  required: CaptureInterval,
  observed: readonly CaptureInterval[],
) {
  let frontier = required.start;
  for (const observation of observed) {
    if (observation.start > frontier) break;
    frontier = Math.max(frontier, observation.end!);
    if (frontier >= required.end!) return true;
  }
  return false;
}

/**
 * The time a 'complete' stream must cover (DEC-218). Each authority interval,
 * a human's speaking grant or a bot's credited publication window, is required
 * from its first captured frame when that arrives within the open tolerance,
 * else from its opening, so a dead microphone stays partial; and until its last
 * captured frame when that ends within the close tolerance, else until its
 * close, since speech stops before a yield reaches the server (DEC-220).
 * For a bot's credited windows only, within the terminal close tolerance of
 * the authority's terminal close, nothing after the stream's final frame is
 * required, in whichever window it falls (ISSUE-806).
 */
export function requiredCoverage(input: {
  readonly authority: readonly CaptureInterval[];
  readonly observed: readonly CaptureInterval[];
  readonly tolerance: CoverageEdges;
}): CaptureInterval[] {
  const finalFrame = terminalFrame(input);
  return input.authority
    .map((interval) => edgeCoverage(interval, input))
    .map(({ start, end }) =>
      finalFrame === null || end === null
        ? { start, end }
        : { start, end: Math.min(end, Math.max(start, finalFrame)) },
    );
}

/** One authority interval, its edges moved to captured frames within the tolerances. */
function edgeCoverage(
  { start, end }: CaptureInterval,
  input: {
    readonly observed: readonly CaptureInterval[];
    readonly tolerance: CoverageEdges;
  },
): CaptureInterval {
  const { openMs, closeMs } = input.tolerance;
  const first = input.observed
    .map((observation) => observation.start)
    .filter(
      (frame) =>
        frame >= start &&
        frame <= start + openMs &&
        (end === null || frame < end),
    );
  const last = input.observed
    .map((observation) => observation.end!)
    .filter((frame) => end !== null && frame > start && frame >= end - closeMs);
  return {
    start: first.length > 0 ? Math.min(...first) : start,
    end: last.length > 0 ? Math.min(end!, Math.max(...last)) : end,
  };
}

/**
 * The stream's final captured frame when the authority's terminal close (the
 * segment cutoff) forgives what follows it, else null. Speech stops before
 * the close reaches the server (DEC-220), and a bot's speech is credited as
 * short windows (DEC-212), so its last window may open after the final frame.
 * Within the close tolerance of the terminal close, nothing after that frame
 * is required, whichever window it falls in (ISSUE-806). The frame must lie
 * inside the authority span: frames that all precede a grant forgive nothing.
 */
function terminalFrame(input: {
  readonly authority: readonly CaptureInterval[];
  readonly observed: readonly CaptureInterval[];
  readonly tolerance: CoverageEdges;
}): number | null {
  const { terminalCloseMs } = input.tolerance;
  if (
    terminalCloseMs === undefined ||
    !input.authority.length ||
    input.authority.some((a) => a.end === null)
  )
    return null;
  const opened = Math.min(...input.authority.map((a) => a.start));
  const close = Math.max(...input.authority.map((a) => a.end!));
  const frames = input.observed
    .map((observation) => observation.end)
    .filter((end): end is number => end !== null && Number.isFinite(end));
  if (!frames.length) return null;
  const final = Math.max(...frames);
  return final > opened && final >= close - terminalCloseMs ? final : null;
}

/** Coverage is producer evidence, independent of transcript text or lease ownership. */
export function hasCompleteCaptureCoverage(input: {
  readonly required: readonly CaptureInterval[];
  readonly observed: readonly CaptureInterval[];
  readonly storedChunks: number;
  readonly expectedChunks: number;
}): boolean {
  if (
    !Number.isSafeInteger(input.storedChunks) ||
    input.storedChunks < 0 ||
    input.storedChunks !== input.expectedChunks ||
    !input.required.every(validRange) ||
    !input.observed.every(validRange)
  )
    return false;
  const required = input.required.filter(({ start, end }) => end! > start);
  const observed = [...input.observed].sort((a, b) => a.start - b.start);
  return (
    required.length > 0 && required.every((grant) => covered(grant, observed))
  );
}
