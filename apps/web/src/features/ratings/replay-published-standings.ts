import type { StandingsRead } from '@daisy/db/ratings';
import { affirmativeSide, negativeSide, winnerOutcome } from '@daisy/protocol';
import type { LadderGame } from '@daisy/tab-engine';
import { foldLeagueRatings } from './league-fold';
import {
  hasRateableTournament,
  leagueRoomGames,
  orderedLeagueGames,
} from './league-input';

/** Only results already released to this audience take part in its replay. */
export function replayPublishedStandings(source: StandingsRead): StandingsRead {
  const replaySeasonIds = new Set(source.publicResults?.replaySeasonIds);
  const legacyRooms = source.publicResults?.legacyRooms ?? [];
  const seasons = new Set([
    ...replaySeasonIds,
    ...(source.certified ?? []).map(({ seasonId }) => seasonId),
    ...legacyRooms.map(({ seasonId }) => seasonId),
  ]);
  if (seasons.size === 0) return source;
  const replayedSeasons = new Set<string>();
  const ratings: StandingsRead['ratings'][number][] = [];
  const changes: StandingsRead['changes'][number][] = [];
  const publicRooms = source.publicResults?.rooms ?? source.changes;
  for (const seasonId of seasons) {
    const certified = source.certified?.find(
      (row) => row.seasonId === seasonId,
    );
    const posted = new Map<string, (typeof publicRooms)[number][]>();
    for (const change of publicRooms) {
      if (change.seasonId !== seasonId) continue;
      const group = posted.get(change.roundId) ?? [];
      group.push(change);
      posted.set(change.roundId, group);
    }
    const rooms: LadderGame[] = [];
    for (const [roundId, rows] of posted) {
      const first = rows[0]!;
      const winner = first.outcome.side;
      const winners = rows
        .filter(({ side }) => side === winner)
        .map(({ actorId }) => actorId);
      const opposition = rows
        .filter(({ side }) => side !== winner)
        .map(({ actorId }) => actorId);
      rooms.push({
        source: 'league_room',
        result: roundId,
        playedAt: ('playedAt' in first && first.playedAt) || first.occurredAt,
        sides: [winners, opposition],
        winner: 0,
      });
    }
    const beforeLedger = legacyRooms.filter(
      (room) => room.seasonId === seasonId && !posted.has(room.id),
    );
    const legacyGames = leagueRoomGames({
      roomRounds: beforeLedger,
      participants: beforeLedger.flatMap(({ id, participants }) =>
        participants.map((person) => ({ ...person, roundId: id })),
      ),
    });
    const games = orderedLeagueGames(
      [...rooms, ...legacyGames],
      certified?.records ?? [],
    );
    if (
      legacyGames.length === 0 &&
      !replaySeasonIds.has(seasonId) &&
      !hasRateableTournament(games)
    )
      continue;
    replayedSeasons.add(seasonId);
    const sides = [affirmativeSide, negativeSide] as const;
    const replay = foldLeagueRatings(
      games,
      ({ game, actorId, participatedOn, occurredAt, before, after }) => {
        changes.push({
          seasonId,
          actorId,
          roundId: game.result,
          occurredAt,
          side: sides[participatedOn],
          outcome: winnerOutcome(sides[game.winner]),
          ratingBefore: before.rating,
          ratingAfter: after.rating,
          deviationBefore: before.deviation,
          deviationAfter: after.deviation,
        });
      },
    );
    const names = new Map(
      [
        ...(certified?.people ?? []),
        ...(source.publicResults?.people ?? []),
        ...beforeLedger.flatMap(({ participants }) => participants),
        ...source.ratings.filter((row) => row.seasonId === seasonId),
      ].map((person) => [person.actorId, person]),
    );
    for (const { actorId, state } of replay) {
      const person = names.get(actorId);
      ratings.push({
        seasonId,
        actorId,
        ...state,
        username: person?.username ?? null,
        accountClosed: person?.accountClosed ?? false,
      });
    }
  }
  return {
    ratings: [
      ...source.ratings.filter(
        ({ seasonId }) => !replayedSeasons.has(seasonId),
      ),
      ...ratings,
    ],
    changes: [
      ...source.changes.filter(
        ({ seasonId }) => !replayedSeasons.has(seasonId),
      ),
      ...changes,
    ],
  };
}
