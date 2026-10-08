import type { RatingPoint } from '../../features/leaderboard/history';
import type { Season } from '../../features/leaderboard/season';
import type { LadderEntry } from '../../features/leaderboard/standing';

/**
 * Sample leaderboard data: two hundred forty debaters per season, made from
 * a seeded generator so every run and every test sees the same ladder.
 * Names, ratings and dates are samples, never real results.
 */
const DAY_MS = 86_400_000;
const SEASON_DAYS = 28;
const STARTING_RATING = 1500;
const STARTING_DEVIATION = 350;
const FIELD = 240;
/** The deleted account's place in every season (shows as a tombstone). */
const DELETED_AT = 17;

const daysFrom = (now: string, days: number): string =>
  new Date(Date.parse(now) + days * DAY_MS).toISOString();

/** Season 4 is live, about sixteen days in; seasons 3 and 2 are closed. */
export const sampleSeasons = (now: string): readonly Season[] => {
  const start = (id: number) => daysFrom(now, -16 - SEASON_DAYS * (4 - id));
  const season = (id: number, status: Season['status']): Season => ({
    id,
    startsAt: start(id),
    endsAt: daysFrom(start(id), SEASON_DAYS),
    status,
  });
  return [season(4, 'active'), season(3, 'closed'), season(2, 'closed')];
};

/** Seeded generator returning floats in [0, 1) (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** a, b, … z, aa, ab, …: the sample usernames. */
const code = (i: number): string =>
  i < 26
    ? String.fromCharCode(97 + i)
    : String.fromCharCode(96 + Math.floor(i / 26)) +
      String.fromCharCode(97 + (i % 26));

const sampleUsername = (i: number): string => `debater-${code(i)}`;

/** The signed-in viewer's sample season lines, keyed by season id. */
const viewerLines: Readonly<
  Record<
    number,
    { rating: number; played: number; wins: number; change: number }
  >
> = {
  4: { rating: 1412, played: 7, wins: 4, change: 14 },
  3: { rating: 1502, played: 40, wins: 23, change: 52 },
};

const generated = (season: number): readonly LadderEntry[] =>
  Array.from({ length: FIELD }, (_, i): LadderEntry => {
    const stable = seeded(i * 131 + 7);
    const varying = seeded(i * 53 + season * 104729);
    const p = (i + 0.5) / FIELD;
    const tail = Math.log((1 - p) / p);
    const provisional = stable() < 0.12;
    const spread = varying();
    const played = provisional
      ? 2 + Math.floor(varying() * 7)
      : 12 + Math.floor(varying() * 68);
    const rating = provisional
      ? Math.round(1300 + varying() * 300)
      : Math.round(1500 + 42 * tail + (spread - 0.5) * 40);
    if (!provisional) varying();
    const winRate = Math.min(
      0.92,
      Math.max(0.15, 0.5 + (rating - 1500) / 650 + (varying() - 0.5) * 0.12),
    );
    const deviation = provisional
      ? Math.round(130 + varying() * 90)
      : Math.round(48 + varying() * 38);
    const weekChange = Math.round((varying() - 0.42) * 14);
    const seasonChange = Math.round((varying() - 0.4) * 44);
    return {
      id: `${season}-${i}`,
      username: i === DELETED_AT ? null : sampleUsername(i),
      rating,
      deviation,
      played,
      wins: Math.round(played * winRate),
      weekChange,
      seasonChange,
    };
  });

/**
 * One season's ladder. A signed-in viewer is added with their sample line
 * where they have one (none in seasons before their first ranked debate).
 */
export function sampleEntries(
  season: number,
  viewer: string | null,
): readonly LadderEntry[] {
  const line = viewerLines[season];
  const field = generated(season);
  if (viewer === null || line === undefined) return field;
  return [
    ...field,
    {
      id: `${season}-viewer`,
      username: viewer,
      rating: line.rating,
      deviation: line.played < 10 ? 170 : 62,
      played: line.played,
      wins: line.wins,
      weekChange: line.change > 0 ? 3 : -2,
      seasonChange: line.change,
    },
  ];
}

/**
 * The rating history behind a sample line: a smooth climb from the starting
 * rating to the final one with seeded noise, deviation shrinking as it goes.
 */
export function sampleHistory(entry: LadderEntry): readonly RatingPoint[] {
  const noise = seeded(entry.id.length * 991 + entry.rating);
  const points: RatingPoint[] = [
    {
      game: 0,
      rating: STARTING_RATING,
      deviation: STARTING_DEVIATION,
      result: null,
      opponent: null,
    },
  ];
  for (let game = 1; game <= entry.played; game += 1) {
    const before = points[game - 1]?.rating ?? STARTING_RATING;
    const deviation =
      game === entry.played
        ? entry.deviation
        : Math.max(
            entry.deviation,
            Math.round(STARTING_DEVIATION * Math.pow(0.88, game)),
          );
    const progress = 1 - Math.exp(-game / (Math.max(entry.played, 8) * 0.4));
    const rating =
      game === entry.played
        ? entry.rating
        : Math.round(
            STARTING_RATING +
              (entry.rating - STARTING_RATING) * progress +
              (noise() - 0.5) * deviation * 0.2,
          );
    points.push({
      game,
      rating,
      deviation,
      result: rating >= before ? 'won' : 'lost',
      opponent: sampleUsername(Math.floor(noise() * 200)),
    });
  }
  return points;
}
