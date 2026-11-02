/** The server clock header carries nonnegative decimal integer milliseconds. */
export const parseServerClockHeader = (
  header: string | null,
): number | null => {
  const decimal = header?.trim();
  if (!decimal || !/^\d+$/.test(decimal)) return null;
  const milliseconds = Number(decimal);
  return Number.isSafeInteger(milliseconds) && milliseconds <= 8.64e15
    ? milliseconds
    : null;
};
