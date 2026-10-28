import type { Database } from '@daisy/db';
import type { RoundView } from '@daisy/protocol';
import { rateDebate } from '@daisy/debate-engine';
import { ratingStanding } from './standing';
import { readRatingStandings } from './read';

export type RoundRating = {
  readonly label: string;
  readonly rating: number | null;
  readonly provisional: boolean;
  readonly delta: number | null;
  readonly win: number | null;
  readonly loss: number | null;
  readonly hidden?: boolean;
};
export type RoundRatingsView = {
  readonly ladder: string;
  readonly season: string;
  readonly rows: readonly RoundRating[];
  readonly pending: boolean;
};

/** Authorized Round read is the named input; the feature alone computes rating stakes. */
export async function readRoundRatings(
  store: Pick<
    Database,
    'listLadderSeasons' | 'readStandings' | 'readRatingBlindings'
  >,
  input: {
    readonly round: RoundView;
    readonly now: string;
    readonly viewerActorId: string | null;
  },
): Promise<RoundRatingsView | null> {
  const { round, now } = input;
  if (round.ladderId === null) return null;
  const published = await readRatingStandings(store, {
    ladder: round.ladderId,
    seasonId: null,
    now,
    ...(input.viewerActorId ? { viewerActorId: input.viewerActorId } : {}),
  });
  if (!published)
    return {
      ladder: round.ladderId,
      season: 'No active season',
      rows: [],
      pending: false,
    };
  const postings = published.postings.filter((c) => c.roundId === round.id);
  const season =
    published.seasons.find((s) => s.id === postings[0]?.seasonId) ??
    published.seasons.find((s) => s.status === 'active');
  if (!season)
    return {
      ladder: round.ladderId,
      season: 'No active season',
      rows: [],
      pending: false,
    };
  const summaries = published.summaries.filter((s) => s.seasonId === season.id);
  const seats = round.participants.filter(
    (p) => p.role !== 'judge' && !('anonymous' in p),
  );
  const standing = (actorId: string) =>
    summaries.find((s) => s.actorId === actorId);
  const affirmative = seats.find((p) => p.role === 'affirmative');
  const negative = seats.find((p) => p.role === 'negative');
  const a =
    affirmative && 'actorId' in affirmative
      ? standing(affirmative.actorId)
      : undefined;
  const n =
    negative && 'actorId' in negative ? standing(negative.actorId) : undefined;
  const calculate = (outcome: 'affirmative' | 'negative') =>
    a && n
      ? rateDebate({
          affirmative: { state: a, lastRatedAt: a.lastRatedAt },
          negative: { state: n, lastRatedAt: n.lastRatedAt },
          occurredAt: now,
          outcome,
        })
      : null;
  const winA =
    postings.length ||
    round.status === 'completed' ||
    round.status === 'abandoned'
      ? null
      : calculate('affirmative');
  const winN =
    postings.length ||
    round.status === 'completed' ||
    round.status === 'abandoned'
      ? null
      : calculate('negative');
  return {
    ladder: round.ladderId,
    season: season.name,
    pending:
      round.status === 'completed' &&
      round.outcome !== null &&
      postings.length === 0,
    rows: seats.flatMap((seat) => {
      if (!('actorId' in seat)) return [];
      if (published.blindedActorIds.includes(seat.actorId))
        return [
          {
            label: seat.label,
            rating: null,
            provisional: false,
            delta: null,
            win: null,
            loss: null,
            hidden: true,
          },
        ];
      const current = standing(seat.actorId);
      const posted = postings.find((p) => p.actorId === seat.actorId);
      const view = current
        ? ratingStanding(
            current,
            current.lastRatedAt,
            season.status === 'closed' ? season.endsAt! : now,
          )
        : null;
      const side = seat.role === 'affirmative' ? 'affirmative' : 'negative';
      const winning = side === 'affirmative' ? winA : winN;
      const losing = side === 'affirmative' ? winN : winA;
      return [
        {
          label: seat.label,
          rating: posted
            ? Math.round(posted.ratingAfter)
            : (view?.rating ?? null),
          provisional: view?.provisional ?? false,
          delta: posted
            ? Math.round(posted.ratingAfter - posted.ratingBefore)
            : null,
          win:
            winning && current
              ? Math.round(winning[side].after.rating - current.rating)
              : null,
          loss:
            losing && current
              ? Math.round(losing[side].after.rating - current.rating)
              : null,
        },
      ];
    }),
  };
}
