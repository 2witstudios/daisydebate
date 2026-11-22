import { isInstantBefore } from '@daisy/clock';

/** The tournament's first day: its earliest scheduled slot, or now while none is. */
export const tournamentFirstDay = (
  slotStarts: readonly string[],
  now: string,
): string =>
  slotStarts.reduce(
    (earliest, start) => (isInstantBefore(start, earliest) ? start : earliest),
    slotStarts[0] ?? now,
  );
