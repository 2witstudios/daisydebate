// The one review-date rule shared by `bun policy` and `bun migrations:check`:
// a time-bounded exception names a real UTC calendar day (YYYY-MM-DD) and
// stays live through that day. Callers own their wording; the rule lives here.
// The migration journal guard runs from a checkout without workspace installs.

export type ReviewDateStatus = 'live' | 'expired' | 'invalid';

/** UTC calendar day (YYYY-MM-DD). Inject `now` in tests; edges pass nothing. */
export const utcToday = (now: Date = new Date()): string =>
  now.toISOString().slice(0, 10);

/** Exactly YYYY-MM-DD and a day the calendar contains (no Date roll-over). */
export const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const atMidnight = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(atMidnight.getTime()) &&
    atMidnight.toISOString().slice(0, 10) === value
  );
};

export const reviewDateStatus = (
  reviewBy: unknown,
  today: string,
): ReviewDateStatus => {
  if (!isIsoDate(reviewBy)) return 'invalid';
  return reviewBy < today ? 'expired' : 'live';
};
