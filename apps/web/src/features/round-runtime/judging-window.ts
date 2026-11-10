import type { RoundWaitingOn } from '@daisy/protocol';

/**
 * The judging window's clock: only a human judge's window, counted to the
 * deadline the server persisted at the freeze. An AI judge has no such window.
 * Read by the debaters' room, the observed Round and the judge's ballot.
 */
export function judgingClockOf(
  status: RoundWaitingOn | null,
  nowMs: number,
): { readonly label: string; readonly remainingMs: number } | null {
  if (status?.state !== 'human_window') return null;
  return {
    label: 'Judging window',
    remainingMs: Math.max(0, Date.parse(status.deadlineAt) - nowMs),
  };
}
