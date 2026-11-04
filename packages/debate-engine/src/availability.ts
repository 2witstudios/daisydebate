import { createInvariantError } from '@daisy/errors';
import { availabilityRecoveryPolicy, type ClockStop } from '@daisy/protocol';

const { recoverySamples, maxSampleGapMs } = availabilityRecoveryPolicy;

type AvailabilitySample = {
  readonly atMs: number;
  readonly healthy: boolean;
};
type OutageInterval = {
  readonly startMs: number;
  readonly endMs: number | null;
};
export type SettledAvailability = {
  readonly historyStartsAtMs: number | null;
  readonly settledHorizonMs: number | null;
  readonly intervals: readonly OutageInterval[];
};

function assertSampleTime(atMs: number, previous: number | null): void {
  if (
    !Number.isSafeInteger(Math.round(atMs * 1000)) ||
    (previous !== null && atMs <= previous)
  )
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
  if (healthyCount < recoverySamples) return { ...state, healthyCount };
  intervals.push({ startMs: state.open, endMs: sample.atMs });
  return { open: null, healthyCount: 0 };
}

/** PG instants retain microseconds: gap starts at the next native tick after H. */
export function deriveOutageIntervals(
  samples: readonly AvailabilitySample[],
): SettledAvailability {
  const intervals: OutageInterval[] = [];
  let previous: number | null = null;
  let open: number | null = null;
  let healthyCount = 0;
  for (const sample of samples) {
    assertSampleTime(sample.atMs, previous);
    const gap = previous !== null && sample.atMs - previous > maxSampleGapMs;
    if (gap) {
      open ??= (Math.round(previous! * 1000) + 1) / 1000;
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

/**
 * A platform incident's span is not healthy for its Round, whatever the samples
 * say: they do not watch the media platform. An open stop never settles, so no
 * deadline can pass through it, and no one can forfeit because of it.
 */
export function withClockStops(
  availability: SettledAvailability,
  stops: readonly ClockStop[],
): SettledAvailability {
  return {
    ...availability,
    intervals: [
      ...availability.intervals,
      ...stops.map((stop) => ({
        startMs: Date.parse(stop.from),
        endMs: stop.to === null ? null : Date.parse(stop.to),
      })),
    ].sort((a, b) => a.startMs - b.startMs),
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
