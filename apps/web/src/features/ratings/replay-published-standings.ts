import type { StandingsRead } from '@daisy/db/ratings';
import { affirmativeSide, negativeSide } from '@daisy/protocol/seats';
import { winnerOutcome } from '@daisy/protocol/round-outcome';
import { foldLeagueRatings } from './league-fold';
import {
  hasRateableTournament,
  leagueRoomGames,
  orderedLeagueGames,
} from './league-input';

/** Only results already released to this audience take part in its replay. */
export function replayPublishedStandings(source: StandingsRead): StandingsRead {
  const replaySeasonIds = new Set(source.publicResults?.replaySeasonIds);
  const seasons = new Set([
    ...replaySeasonIds,
    ...(source.certified ?? []).map(({ seasonId }) => seasonId),
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
    const rooms = leagueRoomGames(
      publicRooms.filter((row) => row.seasonId === seasonId),
    );
    const games = orderedLeagueGames(rooms, certified?.records ?? []);
    if (!replaySeasonIds.has(seasonId) && !hasRateableTournament(games))
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
