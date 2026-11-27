import { instantMs } from '@daisy/clock';
import { mediaWindowEndsAt } from '@daisy/debate-engine/media-window';
import { dueAfterStops, type ClockStop } from '@daisy/protocol/clock-stops';
import {
  roundStartPolicy,
  startGateInstant,
} from '@daisy/protocol/round-start-policy';
import { segmentDueAtMs } from '@daisy/protocol/segment-end';
import { type RuntimeCheckpoint } from '@daisy/protocol/round';

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
  /** When prep ended: the next clock is one microphone lead after it. */
  readonly prepEndedAt: string | null;
  /** When an accepted point of information gives the speech back by itself (INTX-15). */
  readonly pointEndsAt: number | null;
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
    startedAtMs: instantMs(segment.startedAt),
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
    readonly interaction?: {
      readonly pointsOfInformation:
        | { readonly allowed: false }
        | { readonly allowed: true; readonly maxDurationMs: number };
    };
  };
  readonly checkpoint: Pick<
    RuntimeCheckpoint,
    | 'prep'
    | 'prep_consumed_ms'
    | 'clock_stops'
    | 'incident'
    | 'start_gate'
    | 'point_of_information'
  > | null;
  readonly segments: readonly NonNullable<FloorClock['lastSegment']>[];
};
/** The instant an accepted point gives the speech back, by the frozen rule. */
export const pointEndsAtOf = (
  point: RuntimeCheckpoint['point_of_information'] | undefined,
  maxDurationMs: number | null,
): number | null =>
  point?.phase === 'speaking' && maxDurationMs !== null
    ? instantMs(point.accepted_at) + maxDurationMs
    : null;
export const floorClockOf = (round: ClockedRound): FloorClock => {
  const prep = round.checkpoint?.prep;
  const incident = round.checkpoint?.incident ?? { phase: 'none' as const };
  const poi = round.rules.interaction?.pointsOfInformation;
  return {
    startedAt: round.startedAt,
    countdownMs: round.rules.countdownMs,
    segmentTotal: round.rules.segments.length,
    prepBudgetMs: round.rules.inRoundPrep?.budgetMsPerSide ?? null,
    activePrep:
      prep?.phase === 'running'
        ? {
            startedAt: prep.started_at,
            consumedMs: round.checkpoint?.prep_consumed_ms[prep.side] ?? 0,
          }
        : null,
    stops: round.checkpoint?.clock_stops ?? [],
    prepEndedAt: prep?.phase === 'lead' ? prep.ended_at : null,
    pointEndsAt: pointEndsAtOf(
      round.checkpoint?.point_of_information,
      poi?.allowed ? poi.maxDurationMs : null,
    ),
    startGateAt: round.checkpoint?.start_gate
      ? startGateInstant(round.checkpoint.start_gate)
      : null,
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
  const gated = (due: number) =>
    clock.startGateAt ? Math.max(due, instantMs(clock.startGateAt)) : due;
  // The microphone opened when prep ended: only the clock's own start is ahead.
  if (clock.prepEndedAt)
    return [
      gated(
        dueThroughStops(
          clock,
          instantMs(clock.prepEndedAt),
          roundStartPolicy.microphoneLeadMs,
        ),
      ),
    ];
  const anchor =
    clock.segmentCount === 0 ? clock.startedAt : clock.lastSegment?.endedAt;
  if (!anchor) return [];
  const due = dueThroughStops(clock, instantMs(anchor), clock.countdownMs);
  // The microphone opens before the clock, and a gate may hold the clock past its due.
  return [
    ...(clock.countdownMs > 0
      ? [due - Math.min(roundStartPolicy.microphoneLeadMs, clock.countdownMs)]
      : []),
    gated(due),
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
    return clock.hold.resumesAt ? [instantMs(clock.hold.resumesAt)] : [];
  return [
    ...gapBoundaries(clock),
    ...(last?.endedAt === null ? [dueAt(last)] : []),
    // The holder's microphone closes when the point gives the speech back.
    ...(last?.endedAt === null && clock.pointEndsAt !== null
      ? [clock.pointEndsAt]
      : []),
    ...(prep && clock.prepBudgetMs !== null
      ? [
          dueThroughStops(
            clock,
            instantMs(prep.startedAt),
            clock.prepBudgetMs - prep.consumedMs,
          ),
        ]
      : []),
    ...mediaCloseBoundaries(clock),
  ].filter(Number.isFinite);
}
/**
 * The committed instant the floor last changed, at or before `nowMs`: a clock
 * boundary that has passed, the last segment's own start or end (a yield
 * commits an end ahead of its boundary), or prep ending, which opens the microphone. Null before anything has happened.
 */
export function floorDueAt(clock: FloorClock, nowMs: number): number | null {
  const last = clock.lastSegment;
  const passed = [
    ...floorBoundaries(clock),
    ...(last
      ? [
          instantMs(last.startedAt),
          ...(last.endedAt ? [instantMs(last.endedAt)] : []),
        ]
      : []),
    ...(clock.prepEndedAt ? [instantMs(clock.prepEndedAt)] : []),
  ].filter((at) => at <= nowMs);
  return passed.length ? Math.max(...passed) : null;
}
