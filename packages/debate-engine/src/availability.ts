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

function assertSampleTime(atMs: number, previous: number | null): void {
  if (!Number.isSafeInteger(atMs) || (previous !== null && atMs <= previous))
    throw createInvariantError(
      'debate.availability.settled-prefix-stable',
      'Availability samples must strictly increase',
    );
}
type Recovery = { open: number | null; healthyCount: number };
function recoverOutage(
  state: Recovery,
  sample: AvailabilitySample,
  intervals: OutageInterval[],
): Recovery {
  if (!sample.healthy)
    return { open: state.open ?? sample.atMs, healthyCount: 0 };
  if (state.open === null) return state;
  const healthyCount = state.healthyCount + 1;
  if (healthyCount < 3) return { ...state, healthyCount };
  intervals.push({ startMs: state.open, endMs: sample.atMs });
  return { open: null, healthyCount: 0 };
}

/** Millisecond instants: a gap begins at H+1, so H remains settled forever. */
export function deriveOutageIntervals(
  samples: readonly AvailabilitySample[],
): SettledAvailability {
  const intervals: OutageInterval[] = [];
  let previous: number | null = null;
  let open: number | null = null;
  let healthyCount = 0;
  for (const sample of samples) {
    assertSampleTime(sample.atMs, previous);
    const gap = previous !== null && sample.atMs - previous > 2000;
    if (gap) {
      open ??= previous! + 1;
      healthyCount = 0;
    }
    const next = recoverOutage({ open, healthyCount }, sample, intervals);
    open = next.open;
    healthyCount = next.healthyCount;
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
  assertDeadlineTiming(openedAtMs, graceMs);
  if (!coversOpening(historyStartsAtMs, settledHorizonMs, openedAtMs))
    return null;
  // coversOpening proves the horizon exists; local value keeps the loop arithmetic explicit.
  const horizon = settledHorizonMs!;
  let cursor = openedAtMs;
  let remaining = graceMs;
  for (const interval of intervals) {
    if (interval.endMs !== null && interval.endMs <= cursor) continue;
    const healthySpan = Math.max(0, interval.startMs - cursor);
    if (remaining <= healthySpan)
      return cursor + remaining <= horizon ? cursor + remaining : null;
    remaining -= healthySpan;
    if (interval.endMs === null) return null;
    cursor = interval.endMs;
  }
  const deadline = cursor + remaining;
  return deadline <= horizon ? deadline : null;
}

function assertDeadlineTiming(openedAtMs: number, graceMs: number): void {
  if (
    !Number.isSafeInteger(openedAtMs) ||
    !Number.isSafeInteger(graceMs) ||
    graceMs <= 0
  )
    throw createInvariantError(
      'debate.adjudication.failure-postpones-only',
      'Attendance timing must use positive integer milliseconds',
    );
}
const coversOpening = (
  history: number | null,
  horizon: number | null,
  opening: number,
): boolean => history !== null && horizon !== null && history <= opening;
