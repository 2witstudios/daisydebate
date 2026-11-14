import { compareBytes } from '@daisy/seeded-random';
import type { LadderGame, LadderInput } from '../shapes/folds';
import { effectiveResults } from '../standings/effective-results';

type Tournament = LadderInput['tournaments'][number];

/**
 * A sanctioned tournament's ratable games: the latest correction of each
 * result, certified, decided (not administrative) and with a winner. A
 * result naming an entry the tournament does not list is left out.
 */
const gamesOf = (tournament: Tournament): LadderGame[] => {
  const rows = new Map(tournament.results.map((r) => [r.result.id, r]));
  const members = new Map(tournament.entries.map((e) => [e.id, e.members]));
  const history = {
    fixtures: tournament.results.map((r) => ({
      id: r.result.fixture,
      tabRound: 0,
      fixture: r.fixture,
    })),
    results: tournament.results.map((r) => r.result),
  };
  return effectiveResults(history, Number.POSITIVE_INFINITY).flatMap(
    (result) => {
      const row = rows.get(result.id)!;
      const [first, second] = row.fixture.sides;
      const sides = [members.get(first), members.get(second)] as const;
      const winner = result.outcome.winner;
      if (!result.certified || result.kind !== 'decided' || winner === null)
        return [];
      if (sides[0] === undefined || sides[1] === undefined) return [];
      if (winner !== first && winner !== second) return [];
      return [
        {
          result: result.id,
          source: 'tournament' as const,
          playedAt: row.playedAt,
          sides: [sides[0], sides[1]] as const,
          winner: winner === first ? (0 as const) : (1 as const),
        },
      ];
    },
  );
};

/**
 * The games a league's ladder rates, in play order (then result id): its own
 * rooms, and the ratable games of sanctioned tournaments. It rates nothing.
 */
export const LADDER_INPUT_VERSION = 'ladder-input@1';

export const ladderInput = (input: LadderInput): LadderGame[] =>
  [
    ...input.rooms,
    ...input.tournaments.filter((t) => t.sanctioned).flatMap(gamesOf),
  ].sort(
    (a, b) =>
      compareBytes(a.playedAt, b.playedAt) || compareBytes(a.result, b.result),
  );
