/** A season: one ladder, renewed on a schedule (ADR 0029 `seasons`). */
export type Season = {
  readonly id: number;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: 'active' | 'closed';
};

export const seasonLabel = (season: Pick<Season, 'id'>): string =>
  `Season ${season.id}`;

export const isClosed = (season: Season): boolean => season.status === 'closed';

const DAY_MS = 86_400_000;

export type SeasonProgress = {
  /** One-based day of the season at `now`, within 1..length. */
  readonly day: number;
  readonly length: number;
  readonly percent: number;
};

/** How far through its schedule a season is at the injected `now`. */
export function seasonProgress(season: Season, now: string): SeasonProgress {
  const start = Date.parse(season.startsAt);
  const length = Math.max(
    1,
    Math.round((Date.parse(season.endsAt) - start) / DAY_MS),
  );
  const elapsed = Math.floor((Date.parse(now) - start) / DAY_MS);
  const current = Math.min(length, Math.max(1, elapsed + 1));
  return {
    day: current,
    length,
    percent: Math.round((current / length) * 100),
  };
}

const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const day = (iso: string): string => {
  const date = new Date(Date.parse(iso));
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

/** "1 Sep 2026 to 29 Sep 2026", always in UTC so server and test agree. */
export const seasonDates = (season: Season): string =>
  `${day(season.startsAt)} to ${day(season.endsAt)}`;
