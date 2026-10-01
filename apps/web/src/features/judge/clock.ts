/** "1:48": whole minutes, then seconds to two digits. Negative reads as 0:00. */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** "2 min" for a whole number of minutes, otherwise "90 s". */
export const windowLabel = (seconds: number): string =>
  seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;
