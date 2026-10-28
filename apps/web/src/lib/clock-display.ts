/**
 * The m:ss reading of a duration, for every feature that shows one: debate
 * room and spectator clocks, judging windows, Train speech clocks and prep
 * reading times. No feature owns it, so none imports another's clock.
 */

/** "1:48": whole minutes, then seconds to two digits. Negative reads as 0:00. */
export function formatSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A countdown reading: partial seconds round up, so 0:00 means time is up. */
export const formatCountdown = (ms: number): string =>
  formatSeconds(Math.ceil(ms / 1000));
