import { mediaWindowEndsAt } from '@daisy/debate-engine/media-window';
import { segmentDueAtMs } from '@daisy/protocol';

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
  } | null;
  readonly segments: readonly NonNullable<FloorClock['lastSegment']>[];
};
export const floorClockOf = (round: ClockedRound): FloorClock => {
  const prep = round.checkpoint?.active_prep;
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
    segmentCount: round.segments.length,
    lastSegment: round.segments.at(-1) ?? null,
  };
};
const gapBoundaries = (clock: FloorClock): number[] => {
  if (clock.activePrep || clock.segmentCount >= clock.segmentTotal) return [];
  const anchor =
    clock.segmentCount === 0 ? clock.startedAt : clock.lastSegment?.endedAt;
  return anchor ? [Date.parse(anchor) + clock.countdownMs] : [];
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
  return [
    ...gapBoundaries(clock),
    ...(last?.endedAt === null ? [dueAt(last)] : []),
    ...(prep && clock.prepBudgetMs !== null
      ? [Date.parse(prep.startedAt) + clock.prepBudgetMs - prep.consumedMs]
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
