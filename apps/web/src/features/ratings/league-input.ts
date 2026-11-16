import type { LeagueRatingInputs } from '@daisy/db/tab';
import {
  ladderInput,
  type LadderGame,
  type LadderInput,
  type ResultOf,
  type TwoSides,
} from '@daisy/tab-engine';
import { projectResultCompetition } from '../tab/commands/result-projection';
import { createAppError } from '@daisy/errors';

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
  const fixtures = new Map<string, (typeof input.tournaments)[number][]>();
  for (const record of input.tournaments)
    fixtures.set(record.fixtureId, [
      ...(fixtures.get(record.fixtureId) ?? []),
      record,
    ]);
  const tournaments: LadderInput['tournaments'][number][] = [
    ...fixtures.values(),
  ].flatMap((records) => {
    const latest = records.at(-1)!;
    const record = latest.competitionRecord;
    if (
      record.fixture.kind !== 'pairing' ||
      record.fixture.entries.length !== 2
    )
      return [];
    const members = (entryId: string) =>
      record.kind === 'decided'
        ? record.cast
            .filter((person) => person.entryId === entryId)
            .map((person) => person.actorId)
        : record.fixture.entries.find((entry) => entry.entryId === entryId)!
            .members;
    const sides = record.fixture.entries.map((entry) => entry.entryId);
    const projected = records.flatMap((row) => {
      const projected = projectResultCompetition(row.competitionRecord, {
        id: row.id,
        fixture: row.fixtureId,
        supersedes: row.supersedesResultId,
        certified: true,
      });
      if (projected.kind !== 'projected')
        throw createAppError(
          'INVARIANT',
          'Certified rating input cannot be projected',
        );
      if (projected.projection.engine.outcome.kind !== 'winner') return [];
      return [
        {
          result: projected.projection.engine as ResultOf<TwoSides>,
          fixture: {
            kind: 'pairing' as const,
            sides: [sides[0]!, sides[1]!] as const,
            panel: [],
          },
          playedAt: row.playedAt.toISOString(),
        },
      ];
    });
    return [
      {
        event: latest.eventId,
        sanctioned: true,
        entries: sides.map((id) => ({ id, members: members(id) })),
        results: projected,
      },
    ];
  });
  return ladderInput({ rooms, tournaments });
}
