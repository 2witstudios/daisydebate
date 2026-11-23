// The one review-date rule shared by `bun policy` and `bun migrations:check`:
// a time-bounded exception names a real UTC calendar day (YYYY-MM-DD) and
// stays live through that day. Callers own their wording; the rule lives here.

export type ReviewDateStatus = 'live' | 'expired' | 'invalid';

/** UTC calendar day (YYYY-MM-DD). Inject `now` in tests; edges pass nothing. */
export const utcToday = (now: Date = new Date()): string =>
  now.toISOString().slice(0, 10);

/** Exactly YYYY-MM-DD and a day the calendar contains (no Date roll-over). */
export const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lastDay =
    month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return month >= 1 && month <= 12 && day >= 1 && day <= lastDay;
};

export const reviewDateStatus = (
  reviewBy: unknown,
  today: string,
): ReviewDateStatus => {
  if (!isIsoDate(reviewBy)) return 'invalid';
  return reviewBy < today ? 'expired' : 'live';
};
