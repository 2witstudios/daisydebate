export type CaptureInterval = {
  readonly start: number;
  readonly end: number | null;
};
/** How far a required interval's opening and close may move to captured frames. */
export type CoverageEdges = {
  readonly openMs: number;
  readonly closeMs: number;
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
 */
export function requiredCoverage(input: {
  readonly authority: readonly CaptureInterval[];
  readonly observed: readonly CaptureInterval[];
  readonly tolerance: CoverageEdges;
}): CaptureInterval[] {
  const { openMs, closeMs } = input.tolerance;
  return input.authority.map(({ start, end }) => {
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
      .filter(
        (frame) => end !== null && frame > start && frame >= end - closeMs,
      );
    return {
      start: first.length > 0 ? Math.min(...first) : start,
      end: last.length > 0 ? Math.min(end!, Math.max(...last)) : end,
    };
  });
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
