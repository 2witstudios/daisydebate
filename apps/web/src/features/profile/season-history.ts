import { daisyLadders, ladderKey, type Ladder } from '@daisy/protocol';
import { readRatingStandings, type RatingReadStore } from '../ratings/read';

/**
 * One finished season a member was rated in, on one ladder (ADR 0147): the
 * profile's Season history names the ladder each season was on, so a member
 * who turned 18 shows Youth seasons below their Open ones.
 */
export type SeasonHistoryRow = {
  /** Unique per member's history: the ladder and the season. */
  readonly key: string;
  readonly ladder: Ladder;
  readonly season: string;
  readonly rating: number;
  readonly provisional: boolean;
  /** One-based among the season's established debaters; null while provisional. */
  readonly rank: number | null;
  /** Everyone rated on that ladder that season. */
  readonly of: number;
  readonly wins: number;
  readonly losses: number;
};

type LadderRead = {
  readonly ladder: Ladder;
  readonly read: Awaited<ReturnType<typeof readRatingStandings>>;
};

/**
 * Every closed season the member is on, newest first across ladders. A
 * member this viewer is judging shows none: their ratings stay hidden.
 */
export function seasonHistoryOf(
  reads: readonly LadderRead[],
  username: string,
): readonly SeasonHistoryRow[] {
  if (reads.some(({ read }) => read?.blindedUsernames.includes(username)))
    return [];
  return reads
    .flatMap(({ ladder, read }) =>
      (read?.seasons ?? [])
        .filter((season) => season.status === 'closed')
        .flatMap((season) => {
          const entries = read?.entriesBySeason[season.id] ?? [];
          const entry = entries.find((e) => e.username === username);
          if (!entry) return [];
          return [
            {
              startsAt: season.startsAt,
              row: {
                key: `${ladderKey(ladder.style, ladder.division)}:${season.id}`,
                ladder,
                season: season.name,
                rating: Math.round(entry.rating),
                provisional: entry.provisional,
                rank: entry.rank,
                of: entries.length,
                wins: entry.wins,
                losses: entry.losses,
              },
            },
          ];
        }),
    )
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .map(({ row }) => row);
}

/** The member's Season history, from the published standings of every ladder. */
export async function readSeasonHistory(
  store: RatingReadStore,
  input: {
    readonly username: string;
    readonly now: string;
    readonly viewerActorId?: string;
  },
): Promise<readonly SeasonHistoryRow[]> {
  const reads = await Promise.all(
    daisyLadders.map(async (ladder) => ({
      ladder,
      read: await readRatingStandings(store, {
        ladder,
        seasonId: null,
        now: input.now,
        ...(input.viewerActorId ? { viewerActorId: input.viewerActorId } : {}),
      }),
    })),
  );
  return seasonHistoryOf(reads, input.username);
}
