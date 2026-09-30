import {
  sampleEntries,
  sampleHistory,
  sampleSeasons,
} from '../../ui/mock/leaderboard';
import type { RatingPoint } from './history';
import type { LadderData, LadderViewer } from './ladder-view';
import { isClosed, type Season } from './season';
import { rankEntries, type RankedEntry } from './standing';

/**
 * The leaderboard's read seams. There is no backend yet, so each returns the
 * sample ladder; the real reads (standings per season, a debater's rating
 * ledger) replace these functions and nothing else. `username` is the
 * signed-in viewer's public username, or null for a visitor.
 */

const currentSeason = (seasons: readonly Season[]): Season => {
  const current = seasons.find((season) => !isClosed(season)) ?? seasons[0];
  if (!current) throw new Error('no seasons');
  return current;
};

/** The season asked for, or the current one when it does not exist. */
const pickSeason = (seasons: readonly Season[], id: number | null): Season =>
  seasons.find((season) => season.id === id) ?? currentSeason(seasons);

export type LadderRead = {
  readonly data: LadderData;
  readonly viewer: LadderViewer | null;
};

/** One season's standings as the given viewer is allowed to see them. */
export function readLadder(
  seasonId: number | null,
  now: string,
  username: string | null,
): LadderRead {
  const seasons = sampleSeasons(now);
  const season = pickSeason(seasons, seasonId);
  const before = seasons.find((other) => other.id === season.id - 1);
  const champion = before
    ? rankEntries(sampleEntries(before.id, username)).find(
        (entry) => entry.rank === 1,
      )
    : undefined;
  return {
    data: {
      season,
      seasons,
      entries: sampleEntries(season.id, username),
      previousChampion:
        before && champion?.username
          ? {
              season: before.id,
              username: champion.username,
              rating: champion.rating,
            }
          : null,
      pendingChanges: 0,
    },
    // Nobody is judging in the sample, so nothing is blinded.
    viewer: username === null ? null : { username, blinded: [] },
  };
}

type SeasonPlayed = {
  readonly season: Season;
  /** The debater's ranked line that season, or null if they did not play. */
  readonly entry: RankedEntry | null;
};

export type DebaterRead = {
  readonly seasonsPlayed: readonly SeasonPlayed[];
  /** The rating history in the chosen season; empty if they did not play. */
  readonly points: readonly RatingPoint[];
};

/** A debater's line in every season and their history in one of them. */
export function readDebater(
  username: string,
  seasonId: number,
  now: string,
  viewer: string | null,
): DebaterRead {
  const seasonsPlayed = sampleSeasons(now).map((season): SeasonPlayed => ({
    season,
    entry:
      rankEntries(sampleEntries(season.id, viewer)).find(
        (row) => row.username === username,
      ) ?? null,
  }));
  const chosen = seasonsPlayed.find((played) => played.season.id === seasonId);
  return {
    seasonsPlayed,
    points: chosen?.entry ? sampleHistory(chosen.entry) : [],
  };
}
