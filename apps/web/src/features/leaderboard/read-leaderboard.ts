import type { Database } from '@daisy/db';
import type { RatingLadder } from '@daisy/protocol';
import { ratingStanding } from '../ratings/standing';
import type { RatingPoint } from './history';
import type { LadderData, LadderViewer } from './ladder-view';
import type { Season } from './season';
import { rankEntries, type RankedEntry } from './standing';
import { summarizeStandings } from './summarize-standings';

export type LadderRead = {
  readonly data: LadderData;
  readonly viewer: LadderViewer | null;
};
export type DebaterRead = {
  readonly seasonsPlayed: readonly {
    readonly season: Season;
    readonly entry: RankedEntry | null;
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
  const records = await store.listLadderSeasons();
  const seasons: readonly Season[] = records.map((s) => ({
    id: s.id,
    name: s.name,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    status: s.status === 'closed' ? 'closed' : 'active',
  }));
  const season =
    seasons.find((s) => s.id === input.seasonId) ??
    seasons.find((s) => s.status === 'active') ??
    seasons[0];
  if (!season) return null;
  const read = await store.readStandings({
    ladder: input.ladder,
    seasonIds: seasons.map((s) => s.id),
  });
  const blinded = input.viewerActorId
    ? await store.readRatingBlindings(input.viewerActorId)
    : [];
  const summaries = summarizeStandings(
    read,
    new Date(Date.parse(input.now) - 7 * 86_400_000).toISOString(),
  );
  const entriesFor = (seasonId: string) =>
    summaries
      .filter((s) => s.seasonId === seasonId && s.username !== null)
      .map((s) => ({
        id: s.actorId,
        username: s.username!,
        accountClosed: s.accountClosed,
        ...ratingStanding(s, s.lastRatedAt, input.now),
        played: s.played,
        wins: s.wins,
        weekChange: Math.round(s.weekChange),
        seasonChange: Math.round(s.seasonChange),
      }));
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
            blinded: read.ratings
              .filter((r) => blinded.includes(r.actorId))
              .flatMap((r) => (r.username ? [r.username] : [])),
          },
    debater: (username) => {
      const summary = summaries.find(
        (s) => s.seasonId === season.id && s.username === username,
      );
      const changes = summary
        ? read.changes
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
                read.ratings.find(
                  (r) =>
                    r.actorId ===
                    read.changes.find(
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
            rankEntries(entriesFor(s.id)).find(
              (e) => e.username === username,
            ) ?? null,
        })),
        points,
      };
    },
  };
}
