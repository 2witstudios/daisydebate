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
import { endingRating } from '@daisy/debate-engine';

/** The same Room eligibility applies before and after a ledger is introduced. */
export function leagueRoomGames(input: {
  readonly roomRounds: readonly Omit<
    LeagueRatingInputs['roomRounds'][number],
    'legacy'
  >[];
  readonly participants: readonly LeagueRatingInputs['participants'][number][];
}): LadderGame[] {
  // One pass over the seats, so each Round reads only its own.
  const seats = new Map<string, (typeof input.participants)[number][]>();
  for (const person of input.participants)
    seats.set(person.roundId, [...(seats.get(person.roundId) ?? []), person]);
  return input.roomRounds.flatMap((round) => {
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
        playedAt: round.playedAt.toISOString(),
        sides: [sides[0]!, sides[1]!],
        winner: side === first.key ? 0 : 1,
      },
    ];
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
  const games = orderedLeagueGames(leagueRoomGames(input), input.tournaments);
  const legacyRooms = new Set(
    input.roomRounds.filter(({ legacy }) => legacy).map(({ id }) => id),
  );
  if (
    hasRateableTournament(games) ||
    games.some(
      ({ source, result }) =>
        source === 'league_room' && legacyRooms.has(result),
    )
  )
    return foldLeagueRatings(games);
  return input.standings.map(({ rating, deviation, volatility, ...row }) => ({
    ...row,
    state: { rating, deviation, volatility },
  }));
};
