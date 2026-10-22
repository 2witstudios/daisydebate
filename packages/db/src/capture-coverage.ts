export type CaptureInterval = {
  readonly start: number;
  readonly end: number | null;
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
