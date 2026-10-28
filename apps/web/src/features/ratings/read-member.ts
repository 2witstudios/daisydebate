import type { Database } from '@daisy/db';
import { ratingLadders } from '@daisy/protocol';
import type { RatingLadder } from '@daisy/protocol';
export type MemberStanding = {
  readonly ladder: RatingLadder;
  readonly season: string;
  readonly rating: number | null;
  readonly provisional: boolean;
  readonly hidden: boolean;
};
import { readRatingStandings } from './read';

/** The same published data/policy as leaderboard, with one injected read instant. */
export async function readMemberStandings(
  store: Pick<
    Database,
    'listLadderSeasons' | 'readStandings' | 'readRatingBlindings'
  >,
  input: {
    readonly username: string;
    readonly now: string;
    readonly viewerActorId?: string;
  },
): Promise<readonly MemberStanding[]> {
  const reads = await Promise.all(
    ratingLadders.map(async (ladder): Promise<MemberStanding | null> => {
      const read = await readRatingStandings(store, {
        seasonId: null,
        ladder,
        now: input.now,
        ...(input.viewerActorId ? { viewerActorId: input.viewerActorId } : {}),
      });
      if (!read) return null;
      const entry = (read.entriesBySeason[read.season.id] ?? []).find(
        (e) => e.username === input.username,
      );
      return {
        ladder,
        season: read.season.name,
        rating: entry ? Math.round(entry.rating) : null,
        provisional: entry?.provisional ?? false,
        hidden: entry ? read.blindedActorIds.includes(entry.id) : false,
      };
    }),
  );
  return reads.filter((s): s is MemberStanding => s !== null);
}
