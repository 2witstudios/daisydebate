import { createInvariantError } from '@daisy/errors';

export type AvailabilitySample = {
  readonly atMs: number;
  readonly healthy: boolean;
};
export type OutageInterval = {
  readonly startMs: number;
  readonly endMs: number | null;
};
export type SettledAvailability = {
  readonly historyStartsAtMs: number | null;
  readonly settledHorizonMs: number | null;
  readonly intervals: readonly OutageInterval[];
};

/** Millisecond instants: a gap begins at H+1, so H remains settled forever. */
export function deriveOutageIntervals(
  samples: readonly AvailabilitySample[],
): SettledAvailability {
  const intervals: OutageInterval[] = [];
  let previous: number | null = null;
  let open: number | null = null;
  let healthyCount = 0;
  for (const sample of samples) {
    if (
      !Number.isSafeInteger(sample.atMs) ||
      (previous !== null && sample.atMs <= previous)
    )
      throw createInvariantError(
        'debate.availability.settled-prefix-stable',
        'Availability samples must strictly increase',
      );
    const gap = previous !== null && sample.atMs - previous > 2000;
    if (gap) {
      if (open === null) open = previous! + 1;
      healthyCount = 0;
    }
    if (!sample.healthy) {
      if (open === null) open = sample.atMs;
      healthyCount = 0;
    } else if (open !== null) {
      healthyCount++;
      if (healthyCount === 3) {
        intervals.push({ startMs: open, endMs: sample.atMs });
        open = null;
        healthyCount = 0;
      }
    }
    previous = sample.atMs;
  }
  if (open !== null) intervals.push({ startMs: open, endMs: null });
  return {
    historyStartsAtMs: samples[0]?.atMs ?? null,
    settledHorizonMs: previous,
    intervals,
  };
}

/** Consume grace only in settled healthy spans. Unknown history never becomes healthy. */
export function effectiveAttendanceDeadline(input: {
  readonly openedAtMs: number;
  readonly graceMs: number;
  readonly availability: SettledAvailability;
}): number | null {
  const { openedAtMs, graceMs, availability } = input;
  const { historyStartsAtMs, settledHorizonMs, intervals } = availability;
  if (
    !Number.isSafeInteger(openedAtMs) ||
    !Number.isSafeInteger(graceMs) ||
    graceMs <= 0
  )
    throw createInvariantError(
      'debate.adjudication.failure-postpones-only',
      'Attendance timing must use positive integer milliseconds',
    );
  if (
    historyStartsAtMs === null ||
    settledHorizonMs === null ||
    historyStartsAtMs > openedAtMs
  )
    return null;
  let cursor = openedAtMs;
  let remaining = graceMs;
  for (const interval of intervals) {
    if (interval.endMs !== null && interval.endMs <= cursor) continue;
    const healthySpan = Math.max(0, interval.startMs - cursor);
    if (remaining <= healthySpan)
      return cursor + remaining <= settledHorizonMs ? cursor + remaining : null;
    remaining -= healthySpan;
    if (interval.endMs === null) return null;
    cursor = interval.endMs;
  }
  const deadline = cursor + remaining;
  return deadline <= settledHorizonMs ? deadline : null;
}
