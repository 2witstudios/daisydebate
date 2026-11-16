import type { LeagueRatingInputs } from '@daisy/db/tab';
import {
  ladderInput,
  type LadderGame,
  type LadderInput,
  type StageHistory,
  type TwoSides,
} from '@daisy/tab-engine';
import { eventCompetition } from '../tab/operations/event-competition';

/** Consume only the league's received, certified tournament output and own frozen Rooms. */
export function leagueGames(input: LeagueRatingInputs): LadderGame[] {
  const rooms: LadderGame[] = input.roomRounds.flatMap((round) => {
    const [first, second] = round.rules.sides;
    if (
      round.rules.sides.length !== 2 ||
      !first ||
      !second ||
      !round.completedAt
    )
      return [];
    const sides = [first, second].map((side) =>
      input.participants
        .filter(
          (person) => person.roundId === round.id && person.side === side.key,
        )
        .map((person) => person.actorId),
    );
    if (round.winningSide !== first.key && round.winningSide !== second.key)
      return [];
    return [
      {
        result: round.id,
        source: 'league_room',
        playedAt: round.completedAt.toISOString(),
        sides: [sides[0]!, sides[1]!],
        winner: round.winningSide === first.key ? 0 : 1,
      },
    ];
  });
  const tournaments: LadderInput['tournaments'][number][] =
    input.tournaments.flatMap(({ competition, certifiedAt }) => {
      if (certifiedAt === null) return [];
      const folded = eventCompetition(competition, {
        stageIds: competition.stages.map((stage) => stage.id),
        cutoff: Number.MAX_SAFE_INTEGER,
        division: null,
        seed: new TextEncoder().encode(competition.configuration.event.id),
      });
      if (folded.format.outcome !== 'winner') return [];
      const history = folded.history as StageHistory<TwoSides>;
      return [
        {
          event: competition.configuration.event.id,
          sanctioned: true,
          entries: folded.entries,
          results: history.results.flatMap((result) => {
            const fixture = history.fixtures.find(
              (row) => row.id === result.fixture,
            )?.fixture;
            const retained = competition.results.find(
              (row) => row.id === result.id,
            );
            if (
              fixture?.kind !== 'pairing' ||
              fixture.sides.length !== 2 ||
              !retained
            )
              return [];
            return [
              { result, fixture, playedAt: retained.recordedAt.toISOString() },
            ];
          }),
        },
      ];
    });
  return ladderInput({ rooms, tournaments });
}
