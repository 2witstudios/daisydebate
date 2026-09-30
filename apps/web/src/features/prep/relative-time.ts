const DAY_MS = 86_400_000;

/**
 * A coarse "how long ago" for library rows. `now` is injected; the label
 * counts whole days between the two instants.
 */
export function ago(now: string, then: string): string {
  const days = Math.max(
    0,
    Math.floor((Date.parse(now) - Date.parse(then)) / DAY_MS),
  );
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  return `${Math.floor(days / 7)} weeks ago`;
}
