import type { StandingsRead } from '@daisy/db';

/** One debater's line in one season, summed from the ledger. */
export type StandingSummary = {
  readonly seasonId: string;
  readonly actorId: string;
  /** Null once the account is deleted. */
  readonly username: string | null;
  readonly rating: number;
  readonly deviation: number;
  readonly played: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  /** Rating movement from postings at or after `since`. */
  readonly weekChange: number;
  /** Rating movement over the whole season. */
  readonly seasonChange: number;
  readonly lastRatedAt: string | null;
};

type Posting = StandingsRead['changes'][number];

const keyOf = (row: { seasonId: string; actorId: string }) =>
  `${row.seasonId}:${row.actorId}`;

const resultOf = ({ role, outcome }: Posting) =>
  outcome === 'draw' ? 'draws' : outcome === role ? 'wins' : 'losses';

/**
 * Each debater's season line from the `ratings` rows and the ledger: played,
 * the record by seat and outcome, and the rating movement since `since` and
 * over the season. Pure; `since` is the caller's clock. Within a season the
 * ledger is chained, so summing each posting's movement is exact.
 */
export function summarizeStandings(
  read: StandingsRead,
  since: string,
): readonly StandingSummary[] {
  const from = Date.parse(since);
  const postings = new Map<string, Posting[]>();
  for (const change of read.changes) {
    const key = keyOf(change);
    postings.set(key, [...(postings.get(key) ?? []), change]);
  }
  return read.ratings.map((rating) => {
    const own = postings.get(keyOf(rating)) ?? [];
    const count = (result: 'wins' | 'losses' | 'draws') =>
      own.filter((posting) => resultOf(posting) === result).length;
    const moved = (rows: readonly Posting[]) =>
      rows.reduce((sum, row) => sum + row.ratingAfter - row.ratingBefore, 0);
    return {
      seasonId: rating.seasonId,
      actorId: rating.actorId,
      username: rating.username,
      rating: rating.rating,
      deviation: rating.deviation,
      played: own.length,
      wins: count('wins'),
      losses: count('losses'),
      draws: count('draws'),
      weekChange: moved(
        own.filter((row) => Date.parse(row.occurredAt) >= from),
      ),
      seasonChange: moved(own),
      lastRatedAt: own.reduce<string | null>(
        (latest, row) =>
          latest === null || row.occurredAt > latest ? row.occurredAt : latest,
        null,
      ),
    };
  });
}
