import type { Database } from '@daisy/db';
import { daisyLadders, ladderKey } from '@daisy/protocol/ladder';
import type { Ladder } from '@daisy/protocol/ladder';
import { readRatingStandings } from './read';

/**
 * A member's standing on one ladder (ADR 0147): the current season's when
 * they are rated in it; otherwise their last rated season's, kept as history
 * (a member who turned 18 keeps their Youth rating there); otherwise the
 * current season, unrated.
 */
export type MemberStanding = {
  readonly ladder: Ladder;
  /** The ladder's key, unique per member's standings. */
  readonly key: string;
  readonly season: string;
  /** Whether `season` is the division's active season. */
  readonly current: boolean;
  readonly rating: number | null;
  readonly provisional: boolean;
  readonly hidden: boolean;
};

/** The same published data/policy as leaderboard, with one injected read instant. */
export async function readMemberStandings(
  store: Pick<
    Database,
    | 'listLadderSeasons'
    | 'readStandings'
    | 'readRatingBlindings'
    | 'listOfficialRatingLadders'
  >,
  input: {
    readonly username: string;
    readonly now: string;
    readonly viewerActorId?: string;
  },
): Promise<readonly MemberStanding[]> {
  const reads = await Promise.all(
    daisyLadders.map(async (ladder): Promise<MemberStanding | null> => {
      const read = await readRatingStandings(store, {
        seasonId: null,
        ladder,
        now: input.now,
        ...(input.viewerActorId ? { viewerActorId: input.viewerActorId } : {}),
      });
      if (!read) return null;
      const entryIn = (seasonId: string) =>
        (read.entriesBySeason[seasonId] ?? []).find(
          (e) => e.username === input.username,
        );
      const current = entryIn(read.season.id);
      // Seasons come newest start first: the latest one they were rated in.
      const past = current
        ? undefined
        : read.seasons
            .filter((s) => s.id !== read.season.id)
            .map((s) => ({ season: s, entry: entryIn(s.id) }))
            .find((s) => s.entry !== undefined);
      const shown = past ?? { season: read.season, entry: current };
      const entry = shown.entry;
      return {
        ladder,
        key: ladderKey(ladder.style, ladder.division),
        season: shown.season.name,
        current: shown.season.status === 'active',
        rating: entry ? Math.round(entry.rating) : null,
        provisional: entry?.provisional ?? false,
        hidden: entry ? read.blindedActorIds.includes(entry.id) : false,
      };
    }),
  );
  return reads.filter((s): s is MemberStanding => s !== null);
}
