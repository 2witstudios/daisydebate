import {
  affirmativeSide,
  isDebatingSeat,
  isRoundOver,
  negativeSide,
  sideOfSeat,
  winnerOutcome,
} from '@daisy/protocol';
import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import type { Ladder, RoundView } from '@daisy/protocol';
import {
  postingInstant,
  rateDebateSides,
  ratingAwaited,
} from '@daisy/debate-engine';
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
    | 'listOfficialRatingLadders'
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
  if (round.ladder === null || !round.ratingScope) return null;
  const noSeason: RoundRatingsView = {
    ladder: round.ladder,
    season: 'No active season',
    rows: [],
    posting: 'none',
  };
  const published = await readRatingStandings(store, {
    ladder: round.ladder,
    seasonId: round.ratingScope.seasonId,
    frozenLadder: round.ratingScope,
    now,
    revealRoundId: round.id,
    ...(input.viewerActorId ? { viewerActorId: input.viewerActorId } : {}),
  });
  if (!published) return noSeason;
  const postings = published.postings.filter((c) => c.roundId === round.id);
  const season =
    published.seasons.find((s) => s.id === round.ratingScope?.seasonId) ??
    published.seasons.find((s) => s.id === postings[0]?.seasonId) ??
    published.seasons.find((s) => s.status === 'active');
  if (!season) return noSeason;
  let ratedAt = now;
  if (season.status === 'closed') {
    if (season.endsAt === null)
      throw createAppError('INTERNAL', 'A closed season has no end instant');
    ratedAt = season.endsAt;
  }
  const summaries = published.summaries.filter((s) => s.seasonId === season.id);
  const seats = round.participants.filter((p) => isDebatingSeat(p.seat));
  const standing = (actorId: string) =>
    summaries.find((s) => s.actorId === actorId);
  const rated = postings.length > 0;
  const stakes = new Map<string, { win: number; loss: number }>();
  if (!rated && !isRoundOver(round.status) && round.rules.sides.length === 2) {
    const sides = round.rules.sides.map(({ key }) =>
      seats
        .filter((p) => sideOfSeat(p.seat) === key)
        .map((p) => ('actorId' in p ? standing(p.actorId) : undefined)),
    );
    const [first, second] = sides;
    // Every opposing state must be visible to compute a team's public stakes.
    const visible = (
      side: typeof first,
    ): side is NonNullable<ReturnType<typeof standing>>[] =>
      Boolean(side?.length) && side!.every((row) => row !== undefined);
    if (visible(first) && visible(second)) {
      const participants = [...first, ...second];
      const input = {
        affirmative: first.map((state) => ({
          state,
          lastRatedAt: state.lastRatedAt,
        })),
        negative: second.map((state) => ({
          state,
          lastRatedAt: state.lastRatedAt,
        })),
        occurredAt: postingInstant(
          now,
          participants.map(({ lastRatedAt }) => lastRatedAt),
        ),
      };
      const left = rateDebateSides({
        ...input,
        outcome: winnerOutcome(affirmativeSide),
      });
      const right = rateDebateSides({
        ...input,
        outcome: winnerOutcome(negativeSide),
      });
      for (const [actors, wins, losses] of [
        [first, left.affirmative, right.affirmative],
        [second, right.negative, left.negative],
      ] as const) {
        for (const [index, actor] of actors.entries())
          stakes.set(actor.actorId, {
            win: Math.round(wins[index]!.after.rating - actor.rating),
            loss: Math.round(losses[index]!.after.rating - actor.rating),
          });
      }
    }
  }
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
        ? ratingStanding(current, current.lastRatedAt, ratedAt)
        : null;
      const stake = stakes.get(seat.actorId);
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
          win: stake?.win ?? null,
          loss: stake?.loss ?? null,
        },
      ];
    }),
  };
}
