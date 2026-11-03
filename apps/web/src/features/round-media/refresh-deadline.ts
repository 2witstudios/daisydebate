import type { RoundView } from '@daisy/protocol';

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
  } | null;
};
const gapBoundaries = (clock: FloorClock): number[] => {
  if (clock.activePrep || clock.segmentCount >= clock.segmentTotal) return [];
  const anchor =
    clock.segmentCount === 0 ? clock.startedAt : clock.lastSegment?.endedAt;
  return anchor ? [Date.parse(anchor) + clock.countdownMs] : [];
};
const judgingBoundaries = ({
  lastSegment,
  segmentCount,
  segmentTotal,
}: FloorClock): number[] =>
  lastSegment?.endedAt && segmentCount === segmentTotal
    ? [Date.parse(lastSegment.endedAt) + 30 * 60_000]
    : [];
/** Every instant the committed clock next changes who may publish. */
export function floorBoundaries(clock: FloorClock): number[] {
  const last = clock.lastSegment;
  const prep = clock.activePrep;
  return [
    ...gapBoundaries(clock),
    ...(last?.endedAt === null
      ? [Date.parse(last.startedAt) + last.durationMs]
      : []),
    ...(prep && clock.prepBudgetMs !== null
      ? [Date.parse(prep.startedAt) + clock.prepBudgetMs - prep.consumedMs]
      : []),
    ...judgingBoundaries(clock),
  ].filter(Number.isFinite);
}
const viewClock = (view: RoundView): FloorClock => {
  const prep = view.checkpoint?.active_prep;
  return {
    startedAt: view.startedAt,
    countdownMs: view.rules.countdownMs,
    segmentTotal: view.rules.segments.length,
    prepBudgetMs: view.rules.inRoundPrep?.budgetMsPerSide ?? null,
    activePrep: prep
      ? {
          startedAt: prep.started_at,
          consumedMs: view.checkpoint!.prep_consumed_ms[prep.side],
        }
      : null,
    segmentCount: view.segments.length,
    lastSegment: view.segments.at(-1) ?? null,
  };
};
/** These deadlines request a server read; they never open a browser microphone. */
export function nextMediaRefreshAt(view: RoundView): number | null {
  const boundaries = floorBoundaries(viewClock(view));
  return boundaries.length ? Math.min(...boundaries) : null;
}
