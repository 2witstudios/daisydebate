import type { Database } from '@daisy/db';
import { ratingLadders } from '@daisy/protocol';
import type { RatingLadder } from '@daisy/protocol';
import { rankEntries } from '../leaderboard/standing';
export type MemberStanding = {
  readonly ladder: RatingLadder;
  readonly season: string;
  readonly rating: number | null;
  readonly provisional: boolean;
  readonly hidden: boolean;
};
import { readLadder } from '../leaderboard/read-leaderboard';

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
      const read = await readLadder(store, {
        seasonId: null,
        ladder,
        now: input.now,
        username: input.username,
        ...(input.viewerActorId ? { viewerActorId: input.viewerActorId } : {}),
      });
      if (!read) return null;
      const entry = rankEntries(read.data.entries).find(
        (e) => e.username === input.username,
      );
      return {
        ladder,
        season: read.data.season.name,
        rating: entry?.rating ?? null,
        provisional: entry?.provisional ?? false,
        hidden: read.viewer?.blinded.includes(input.username) ?? false,
      };
    }),
  );
  return reads.filter((s): s is MemberStanding => s !== null);
}
