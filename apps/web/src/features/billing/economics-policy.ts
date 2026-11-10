import { economicsInstant, isEconomicsWindow } from './economics-input';

/** DEC366's recorded provisional default; changing it requires the owning policy record. */
export const recordedMarginFloorBasisPoints = 3000;

/** A supplier measurement cannot lower the policy floor; explicit unknown remains unknown. */
export function hasRecordedEconomicsFloor(value: unknown) {
  return (
    typeof value === 'object' &&
    value !== null &&
    'floorBasisPoints' in value &&
    (value.floorBasisPoints === null ||
      value.floorBasisPoints === recordedMarginFloorBasisPoints)
  );
}

/** A completed UTC calendar window, independent of current price, grants or account identity. */
export function previousEconomicsMonth(now: string) {
  if (!economicsInstant.safeParse(now).success) return null;
  const end = new Date(now);
  end.setUTCDate(1);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 1);
  const startsAt = start.toISOString(),
    endsAt = end.toISOString();
  return isEconomicsWindow({ startsAt, endsAt }) ? { startsAt, endsAt } : null;
}
