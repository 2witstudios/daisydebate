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
import { endingRating } from '@daisy/debate-engine';

/** Consume only the league's received, certified tournament output and own frozen Rooms. */
export function leagueGames(input: LeagueRatingInputs): LadderGame[] {
  // One pass over the seats, so each Round reads only its own.
  const seats = new Map<string, (typeof input.participants)[number][]>();
  for (const person of input.participants)
    seats.set(person.roundId, [...(seats.get(person.roundId) ?? []), person]);
  const rooms: LadderGame[] = input.roomRounds.flatMap((round) => {
    const [first, second] = round.rules.sides;
    // Daisy's own rule for whether an ending rates: a Round Daisy refuses
    // (unrecorded, unjudged, check-in pending, attendance unsettled, no
    // winner) counts on no league ladder either. An unreadable row never rates.
    const rated = round.ending ? endingRating(round.ending) : null;
    if (
      rated?.kind !== 'rated' ||
      round.rules.sides.length !== 2 ||
      !first ||
      !second
    )
      return [];
    const sides = [first, second].map((side) =>
      (seats.get(round.id) ?? [])
        .filter((person) => person.side === side.key)
        .map((person) => person.actorId),
    );
    const { side } = rated.outcome;
    if (side !== first.key && side !== second.key) return [];
    return [
      {
        result: round.id,
        source: 'league_room',
        playedAt: rated.occurredAt,
        sides: [sides[0]!, sides[1]!],
        winner: side === first.key ? 0 : 1,
      },
    ];
  });
  type TournamentRecord = (typeof input.tournaments)[number];
  const fixtures = new Map<
    string,
    { readonly records: TournamentRecord[]; readonly latest: TournamentRecord }
  >();
  for (const record of input.tournaments)
    fixtures.set(record.fixtureId, {
      records: [...(fixtures.get(record.fixtureId)?.records ?? []), record],
      latest: record,
    });
  const tournaments: LadderInput['tournaments'][number][] = [
    ...fixtures.values(),
  ].flatMap(({ records, latest }) => {
    const record = latest.competitionRecord;
    if (
      record.fixture.kind !== 'pairing' ||
      record.fixture.entries.length !== 2
    )
      return [];
    const members = (entryId: string) => {
      if (record.kind === 'decided')
        return record.cast
          .filter((person) => person.entryId === entryId)
          .map((person) => person.actorId);
      const entry = record.fixture.entries.find(
        (entry) => entry.entryId === entryId,
      );
      if (!entry)
        throw createAppError('INVARIANT', 'Missing rating input entry');
      return entry.members;
    };
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
