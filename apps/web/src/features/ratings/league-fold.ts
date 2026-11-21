import {
  postingInstant,
  rateDebateSides,
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

type LeaguePosting = {
  readonly game: LadderGame;
  readonly actorId: string;
  readonly participatedOn: 0 | 1;
  readonly occurredAt: string;
  readonly before: DebaterRating['state'];
  readonly after: DebaterRating['state'];
};

/** Replay the league's published games; every member meets the opposing pre-game mean. */
export function foldLeagueRatings(
  games: readonly LadderGame[],
  onPosting?: (posting: LeaguePosting) => void,
): LeagueRating[] {
  const ratings = new Map<string, LeagueRating>();
  const seen = new Set<string>();
  for (const game of games) {
    const identity = `${game.source}:${game.result}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
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
    const rated = rateDebateSides({
      affirmative: sides[0],
      negative: sides[1],
      occurredAt,
      outcome: {
        kind: 'winner',
        side: game.winner === 0 ? 'affirmative' : 'negative',
      },
    });
    const changes = [rated.affirmative, rated.negative] as const;
    for (const [index, side] of sides.entries()) {
      const won = game.winner === index;
      for (const [memberIndex, row] of side.entries()) {
        const after = changes[index]![memberIndex]!.after;
        onPosting?.({
          game,
          actorId: row.actorId,
          participatedOn: index === 0 ? 0 : 1,
          occurredAt,
          before: row.state,
          after,
        });
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
