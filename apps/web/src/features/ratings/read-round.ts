import {
  affirmativeSide,
  isDebatingSeat,
  isRoundOver,
  negativeSide,
  sideOfSeat,
  winnerOutcome,
  type TwoSideKey,
} from '@daisy/protocol';
import type { Database } from '@daisy/db';
import type { Ladder, RoundView } from '@daisy/protocol';
import { rateDebate, ratingAwaited } from '@daisy/debate-engine';
import { ratingClassification, ratingStanding } from './standing';
import { readRatingStandings } from './read';

type RoundRating = {
  readonly label: string;
  readonly rating: number | null;
  readonly provisional: boolean;
  readonly delta: number | null;
  readonly win: number | null;
  readonly loss: number | null;
  readonly hidden?: boolean;
};
export type RoundRatingsView = {
  readonly ladder: Ladder;
  readonly season: string;
  readonly rows: readonly RoundRating[];
  /** What this viewer may see of the posting: a blinded debater's is not read. */
  readonly posting: 'rated' | 'pending' | 'none';
};

const roundAwaitsRating = async (
  store: Pick<Database, 'readRatingFacts'>,
  roundId: string,
) => {
  const facts = await store.readRatingFacts(roundId);
  return facts !== null && ratingAwaited(facts);
};

/** Authorized Round read is the named input; the feature alone computes rating stakes. */
export async function readRoundRatings(
  store: Pick<
    Database,
    | 'listLadderSeasons'
    | 'readStandings'
    | 'readRatingBlindings'
    | 'readRatingFacts'
  >,
  input: {
    readonly round: RoundView;
    readonly now: string;
    readonly viewerActorId: string | null;
  },
): Promise<RoundRatingsView | null> {
  const { round, now } = input;
  if (round.ladder === null) return null;
  const noSeason: RoundRatingsView = {
    ladder: round.ladder,
    season: 'No active season',
    rows: [],
    posting: 'none',
  };
  const published = await readRatingStandings(store, {
    ladder: round.ladder,
    seasonId: null,
    now,
    revealRoundId: round.id,
    ...(input.viewerActorId ? { viewerActorId: input.viewerActorId } : {}),
  });
  if (!published) return noSeason;
  const postings = published.postings.filter((c) => c.roundId === round.id);
  const season =
    published.seasons.find((s) => s.id === postings[0]?.seasonId) ??
    published.seasons.find((s) => s.status === 'active');
  if (!season) return noSeason;
  const summaries = published.summaries.filter((s) => s.seasonId === season.id);
  const seats = round.participants.filter(
    (p) => !('anonymous' in p) && isDebatingSeat(p.seat),
  );
  const standing = (actorId: string) =>
    summaries.find((s) => s.actorId === actorId);
  const onSide = (side: TwoSideKey) =>
    seats.find((p) => sideOfSeat(p.seat) === side);
  const affirmative = onSide(affirmativeSide);
  const negative = onSide(negativeSide);
  const a =
    affirmative && 'actorId' in affirmative
      ? standing(affirmative.actorId)
      : undefined;
  const n =
    negative && 'actorId' in negative ? standing(negative.actorId) : undefined;
  const calculate = (side: TwoSideKey) =>
    a && n
      ? rateDebate({
          affirmative: { state: a, lastRatedAt: a.lastRatedAt },
          negative: { state: n, lastRatedAt: n.lastRatedAt },
          occurredAt: now,
          outcome: winnerOutcome(side),
        })
      : null;
  const rated = postings.length > 0;
  const staked = !rated && !isRoundOver(round.status);
  const winA = staked ? calculate(affirmativeSide) : null;
  const winN = staked ? calculate(negativeSide) : null;
  return {
    ladder: round.ladder,
    season: season.name,
    posting: rated
      ? 'rated'
      : round.status === 'completed' &&
          round.outcome !== null &&
          (await roundAwaitsRating(store, round.id))
        ? 'pending'
        : 'none',
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
      const onAffirmative = sideOfSeat(seat.seat) === affirmativeSide;
      const after = (rated: typeof winA) =>
        rated && (onAffirmative ? rated.affirmative : rated.negative);
      const winning = after(onAffirmative ? winA : winN);
      const losing = after(onAffirmative ? winN : winA);
      return [
        {
          label: seat.label,
          rating: posted
            ? Math.round(posted.ratingAfter)
            : (view?.rating ?? null),
          provisional: posted
            ? ratingClassification(posted.deviationAfter) === 'provisional'
            : (view?.provisional ?? false),
          delta: posted
            ? Math.round(posted.ratingAfter - posted.ratingBefore)
            : null,
          win:
            winning && current
              ? Math.round(winning.after.rating - current.rating)
              : null,
          loss:
            losing && current
              ? Math.round(losing.after.rating - current.rating)
              : null,
        },
      ];
    }),
  };
}
