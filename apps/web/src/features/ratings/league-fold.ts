import {
  inflateDeviation,
  postingInstant,
  rateDebate,
  ratingPolicy,
  type DebaterRating,
} from '@daisy/debate-engine';
import type { LadderGame } from '@daisy/tab-engine';

export type LeagueRating = DebaterRating & {
  readonly actorId: string;
  readonly games: number;
  readonly wins: number;
  readonly change: number;
};

/** Replay the league's published games; every member meets the opposing pre-game mean. */
export function foldLeagueRatings(
  games: readonly LadderGame[],
): LeagueRating[] {
  const ratings = new Map<string, LeagueRating>();
  const seen = new Set<string>();
  for (const game of games) {
    if (seen.has(game.result)) continue;
    seen.add(game.result);
    const [first, second] = game.sides;
    if (
      first.length === 0 ||
      second.length === 0 ||
      new Set([...first, ...second]).size !== first.length + second.length
    )
      continue;
    const before = (actorId: string): LeagueRating =>
      ratings.get(actorId) ?? {
        actorId,
        state: ratingPolicy.initial,
        lastRatedAt: null,
        games: 0,
        wins: 0,
        change: 0,
      };
    const sides = [first.map(before), second.map(before)] as const;
    const occurredAt = postingInstant(
      game.playedAt,
      sides.flat().map((row) => row.lastRatedAt),
    );
    const opponent = (side: readonly LeagueRating[]): DebaterRating => {
      const states = side.map((row) =>
        inflateDeviation(row.state, row.lastRatedAt, occurredAt),
      );
      const mean = (key: keyof DebaterRating['state']) =>
        states.reduce((sum, state) => sum + state[key], 0) / states.length;
      return {
        state: {
          rating: mean('rating'),
          deviation: mean('deviation'),
          volatility: mean('volatility'),
        },
        lastRatedAt: occurredAt,
      };
    };
    const opponents = [opponent(sides[1]), opponent(sides[0])] as const;
    for (const [index, side] of sides.entries()) {
      const won = game.winner === index;
      for (const row of side) {
        const after = rateDebate({
          affirmative: row,
          negative: opponents[index]!,
          occurredAt,
          outcome: { kind: 'winner', side: won ? 'affirmative' : 'negative' },
        }).affirmative.after;
        ratings.set(row.actorId, {
          actorId: row.actorId,
          state: after,
          lastRatedAt: occurredAt,
          games: row.games + 1,
          wins: row.wins + Number(won),
          change: after.rating - row.state.rating,
        });
      }
    }
  }
  return [...ratings.values()];
}
