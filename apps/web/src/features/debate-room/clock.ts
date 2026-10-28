export type ClockUrgency = 'normal' | 'low' | 'critical' | 'over';

export function clockUrgency(remainingMs: number): ClockUrgency {
  if (remainingMs <= 0) return 'over';
  if (remainingMs <= 15_000) return 'critical';
  if (remainingMs <= 60_000) return 'low';
  return 'normal';
}

/** What a screen reader hears as the clock crosses a mark; null between marks. */
export function clockMilestone(remainingMs: number): string | null {
  if (remainingMs <= 0) return 'Time';
  if (remainingMs <= 30_000) return '30 seconds left';
  if (remainingMs <= 60_000) return '1 minute left';
  return null;
}
