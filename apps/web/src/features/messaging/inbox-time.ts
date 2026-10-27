const minute = 60_000,
  hour = 60 * minute,
  day = 24 * hour;
const monthDay = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const monthDayYear = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Compact inbox age: minutes, hours and days within a week, then a UTC date. */
export function formatInboxTime(at: string, now: string): string {
  const then = Date.parse(at),
    elapsed = Date.parse(now) - then;
  if (elapsed < minute) return 'now';
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h`;
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)}d`;
  return new Date(then).getUTCFullYear() === new Date(now).getUTCFullYear()
    ? monthDay.format(then)
    : monthDayYear.format(then);
}
