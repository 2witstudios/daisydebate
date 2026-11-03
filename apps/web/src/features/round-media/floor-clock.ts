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
