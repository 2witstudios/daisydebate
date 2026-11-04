import { mediaWindowEndsAt } from '@daisy/debate-engine/media-window';
import {
  dueAfterStops,
  roundStartPolicy,
  segmentDueAtMs,
  type ClockStop,
  type RoundIncident,
  type RoundStartGate,
} from '@daisy/protocol';

/** What a Round's clock boundaries are read from, in the browser's view or a server row. */
export type FloorClock = {
  readonly startedAt: string | null;
  readonly countdownMs: number;
  readonly segmentTotal: number;
  readonly prepBudgetMs: number | null;
  readonly activePrep: {
    readonly startedAt: string;
    readonly consumedMs: number;
  } | null;
  /** Spans the clock did not run, closed: every wait is due that much later. */
  readonly stops: readonly ClockStop[];
  /** A start gate's own instant for the coming segment; null when none holds it. */
  readonly startGateAt: string | null;
  /** A platform incident holds the clock: only its countdown's end moves anything. */
  readonly hold: { readonly resumesAt: string | null } | null;
  readonly segmentCount: number;
  readonly lastSegment: {
    readonly startedAt: string;
    readonly endedAt: string | null;
    readonly durationMs: number;
    readonly returnedMs: number;
  } | null;
};
/** When the open segment is due, from its committed row. */
export const dueAt = (segment: NonNullable<FloorClock['lastSegment']>) =>
  segmentDueAtMs({
    startedAtMs: Date.parse(segment.startedAt),
    durationMs: segment.durationMs,
    returnedMs: segment.returnedMs,
  });

/** A Round as the browser's view and a server snapshot both carry it. */
type ClockedRound = {
  readonly startedAt: string | null;
  readonly rules: {
    readonly countdownMs: number;
    readonly segments: readonly unknown[];
    readonly inRoundPrep?: { readonly budgetMsPerSide: number } | null;
  };
  readonly checkpoint: {
    readonly active_prep: {
      readonly started_at: string;
      readonly side: string;
    } | null;
    readonly prep_consumed_ms: Readonly<Record<string, number>>;
    readonly clock_stops: readonly ClockStop[];
    readonly incident: RoundIncident;
    readonly start_gate: RoundStartGate;
  } | null;
  readonly segments: readonly NonNullable<FloorClock['lastSegment']>[];
};
/** The instant a start gate holds the coming segment to. */
export const startGateAtOf = (gate: RoundStartGate): string | null =>
  gate === null ? null : gate.phase === 'awaiting' ? gate.until : gate.at;
export const floorClockOf = (round: ClockedRound): FloorClock => {
  const prep = round.checkpoint?.active_prep;
  const incident = round.checkpoint?.incident ?? { phase: 'none' as const };
  return {
    startedAt: round.startedAt,
    countdownMs: round.rules.countdownMs,
    segmentTotal: round.rules.segments.length,
    prepBudgetMs: round.rules.inRoundPrep?.budgetMsPerSide ?? null,
    activePrep: prep
      ? {
          startedAt: prep.started_at,
          consumedMs: round.checkpoint!.prep_consumed_ms[prep.side] ?? 0,
        }
      : null,
    stops: round.checkpoint?.clock_stops ?? [],
    startGateAt: startGateAtOf(round.checkpoint?.start_gate ?? null),
    hold:
      incident.phase === 'none'
        ? null
        : { resumesAt: incident.phase === 'resuming' ? incident.until : null },
    segmentCount: round.segments.length,
    lastSegment: round.segments.at(-1) ?? null,
  };
};
/** The stops are all closed here: an open one has no boundary until it ends. */
const dueThroughStops = (clock: FloorClock, anchorMs: number, waitMs: number) =>
  dueAfterStops(anchorMs, waitMs, clock.stops, anchorMs);
const gapBoundaries = (clock: FloorClock): number[] => {
  if (clock.activePrep || clock.segmentCount >= clock.segmentTotal) return [];
  const anchor =
    clock.segmentCount === 0 ? clock.startedAt : clock.lastSegment?.endedAt;
  if (!anchor) return [];
  const due = dueThroughStops(clock, Date.parse(anchor), clock.countdownMs);
  // The microphone opens before the clock, and a gate may hold the clock past its due.
  return [
    ...(clock.countdownMs > 0
      ? [due - Math.min(roundStartPolicy.microphoneLeadMs, clock.countdownMs)]
      : []),
    clock.startGateAt ? Math.max(due, Date.parse(clock.startGateAt)) : due,
  ];
};
const mediaCloseBoundaries = ({
  lastSegment,
  segmentCount,
  segmentTotal,
}: FloorClock): number[] =>
  lastSegment?.endedAt && segmentCount === segmentTotal
    ? [mediaWindowEndsAt(lastSegment.endedAt)]
    : [];
/** Every instant the committed clock next changes who may publish. */
export function floorBoundaries(clock: FloorClock): number[] {
  const last = clock.lastSegment;
  const prep = clock.activePrep;
  if (clock.hold)
    return clock.hold.resumesAt ? [Date.parse(clock.hold.resumesAt)] : [];
  return [
    ...gapBoundaries(clock),
    ...(last?.endedAt === null ? [dueAt(last)] : []),
    ...(prep && clock.prepBudgetMs !== null
      ? [
          dueThroughStops(
            clock,
            Date.parse(prep.startedAt),
            clock.prepBudgetMs - prep.consumedMs,
          ),
        ]
      : []),
    ...mediaCloseBoundaries(clock),
  ].filter(Number.isFinite);
}
/**
 * The committed instant the floor last changed, at or before `nowMs`: a clock
 * boundary that has passed, or the last segment's own start or end (a yield
 * commits an end ahead of its boundary). Null before anything has happened.
 */
export function floorDueAt(clock: FloorClock, nowMs: number): number | null {
  const last = clock.lastSegment;
  const passed = [
    ...floorBoundaries(clock),
    ...(last
      ? [
          Date.parse(last.startedAt),
          ...(last.endedAt ? [Date.parse(last.endedAt)] : []),
        ]
      : []),
  ].filter((at) => at <= nowMs);
  return passed.length ? Math.max(...passed) : null;
}
