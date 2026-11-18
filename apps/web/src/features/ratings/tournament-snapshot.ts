import {
  inflateDeviation,
  RATING_CALCULATION_VERSION,
} from '@daisy/debate-engine';
import type { EventSettingContext, LeagueRatingInputs } from '@daisy/db/tab';
import type { TournamentRatingSnapshot } from '@daisy/protocol/lobby/rating-snapshot';
import { eventSettingResolution } from '../tab/operations/event-setting-resolution';
import { foldLeagueRatings } from './league-fold';
import { leagueGames } from './league-input';

/** One tournament start input, including an explicit no-ladder decision for each event. */
export function freezeTournamentRatings(
  configurations: readonly EventSettingContext[],
  inputs: readonly LeagueRatingInputs[],
  takenAt: string,
): TournamentRatingSnapshot {
  return {
    takenAt,
    calculation: RATING_CALCULATION_VERSION,
    events: configurations.map((configuration) => ({
      eventId: configuration.event.id,
      ladderId:
        eventSettingResolution(configuration).settings[
          'standings.rating_ladder'
        ].value.ladderId,
    })),
    ladders: inputs.map((input) => ({
      ladderId: input.ladder.id,
      actors: foldLeagueRatings(leagueGames(input)).map((row) => {
        const state = inflateDeviation(row.state, row.lastRatedAt, takenAt);
        return {
          actorId: row.actorId,
          rating: state.rating,
          deviation: state.deviation,
        };
      }),
    })),
  };
}
