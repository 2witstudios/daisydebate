/** The tournament's first day: its earliest scheduled slot, or now while none is. */
export const tournamentFirstDay = (
  slotStarts: readonly string[],
  now: string,
): string =>
  slotStarts.reduce(
    (earliest, start) =>
      Date.parse(start) < Date.parse(earliest) ? start : earliest,
    slotStarts[0] ?? now,
  );
