import { foldLeagueRatings } from './league-fold';
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
import type { StandingsRead } from '@daisy/db/ratings';

type RoomPosting = NonNullable<StandingsRead['publicResults']>['rooms'][number];

/** A Room enters a replay only through its actual posted competitors. */
export function leagueRoomGames(
  postings: readonly RoomPosting[],
): LadderGame[] {
  const byRound = new Map<string, RoomPosting[]>();
  for (const posting of postings) {
    const group = byRound.get(posting.roundId) ?? [];
    group.push(posting);
    byRound.set(posting.roundId, group);
  }
  return [...byRound.entries()].map(([result, group]) => {
    const first = group[0]!;
    const winner = first.outcome.side;
    return {
      result,
      source: 'league_room',
      playedAt: first.occurredAt,
      sides: [
        group
          .filter(({ side }) => side === winner)
          .map(({ actorId }) => actorId),
        group
          .filter(({ side }) => side !== winner)
          .map(({ actorId }) => actorId),
      ],
      winner: 0,
    };
  });
}

export const orderedLeagueGames = (
  rooms: readonly LadderGame[],
  certified: LeagueRatingInputs['tournaments'],
) => ladderInput({ rooms, tournaments: certifiedTournaments(certified) });

function certifiedTournaments(
  certified: LeagueRatingInputs['tournaments'],
): LadderInput['tournaments'] {
  const fixtures = new Map<string, (typeof certified)[number][]>();
  for (const record of certified)
    fixtures.set(record.fixtureId, [
      ...(fixtures.get(record.fixtureId) ?? []),
      record,
    ]);
  return [...fixtures.values()].flatMap((records) => {
    const latest = records.at(-1)!;
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
}

export const hasRateableTournament = (games: readonly LadderGame[]) =>
  games.some(
    ({ source, sides: [first, second] }) =>
      source === 'tournament' &&
      first.length > 0 &&
      second.length > 0 &&
      new Set([...first, ...second]).size === first.length + second.length,
  );

export const leagueStandings = (input: LeagueRatingInputs) => {
  const games = orderedLeagueGames(
    leagueRoomGames(input.roomPostings),
    input.tournaments,
  );
  if (hasRateableTournament(games)) return foldLeagueRatings(games);
  return input.standings.map(({ rating, deviation, volatility, ...row }) => ({
    ...row,
    state: { rating, deviation, volatility },
  }));
};
