import type { Database } from '@daisy/db';
import type { RatingLadder } from '@daisy/protocol';
import { readRatingStandings } from '../ratings/read';
import type { RatingPoint } from './history';
import type { LadderData, LadderViewer } from './ladder-view';
import type { Season } from './season';
import { rankRatingEntries, type RankedRatingEntry } from '../ratings/rank';

export type LadderRead = {
  readonly data: LadderData;
  readonly viewer: LadderViewer | null;
};
export type DebaterRead = {
  readonly seasonsPlayed: readonly {
    readonly season: Season;
    readonly entry: RankedRatingEntry | null;
  }[];
  readonly points: readonly RatingPoint[];
};

type Store = Pick<
  Database,
  'listLadderSeasons' | 'readStandings' | 'readRatingBlindings'
>;

/** One authoritative snapshot is reused by the ladder and open detail. */
export async function readLadder(
  store: Store,
  input: {
    readonly seasonId: string | null;
    readonly ladder: RatingLadder;
    readonly now: string;
    readonly username: string | null;
    readonly viewerActorId?: string;
  },
): Promise<
  (LadderRead & { readonly debater: (username: string) => DebaterRead }) | null
> {
  const published = await readRatingStandings(store, input);
  if (!published) return null;
  const { season, seasons, summaries } = published;
  const entriesFor = (seasonId: string) =>
    published.entriesBySeason[seasonId] ?? [];
  return {
    data: {
      season,
      seasons,
      entries: entriesFor(season.id),
      previousChampion: null,
      pendingChanges: 0,
    },
    viewer:
      input.username === null
        ? null
        : {
            username: input.username,
            blinded: published.blindedUsernames,
          },
    debater: (username) => {
      const summary = summaries.find(
        (s) => s.seasonId === season.id && s.username === username,
      );
      const changes = summary
        ? published.postings
            .filter(
              (c) => c.actorId === summary.actorId && c.seasonId === season.id,
            )
            .sort(
              (a, b) =>
                a.occurredAt.localeCompare(b.occurredAt) ||
                a.roundId.localeCompare(b.roundId),
            )
        : [];
      const first = changes[0];
      const points: RatingPoint[] = first
        ? [
            {
              game: 0,
              rating: first.ratingBefore,
              deviation: first.deviationBefore,
              result: null,
              opponent: null,
            },
            ...changes.map((c, i) => ({
              game: i + 1,
              rating: c.ratingAfter,
              deviation: c.deviationAfter,
              result:
                c.outcome === 'draw'
                  ? null
                  : c.outcome === c.role
                    ? ('won' as const)
                    : ('lost' as const),
              opponent:
                summaries.find(
                  (r) =>
                    r.actorId ===
                    published.postings.find(
                      (other) =>
                        other.roundId === c.roundId &&
                        other.actorId !== c.actorId,
                    )?.actorId,
                )?.username ?? null,
            })),
          ]
        : [];
      return {
        seasonsPlayed: seasons.map((s) => ({
          season: s,
          entry:
            rankRatingEntries(entriesFor(s.id)).find(
              (e) => e.username === username,
            ) ?? null,
        })),
        points,
      };
    },
  };
}
