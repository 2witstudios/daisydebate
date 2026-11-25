import type { Ladder, RatingDivision } from '@daisy/protocol/ladder';
import type { MemberStanding } from '../../features/ratings/read-member';
import {
  markedRating,
  provisionalMarkClass,
} from '../../features/ratings/provisional-mark';
import type { ShellRatings } from '../layout/app-shell/account';
import { cn } from '../cn';

/** What a ladder row shows: the rating, or the state it is in. */
export function ratingText(standing: MemberStanding): string {
  if (standing.hidden) return 'Hidden while judging';
  if (standing.rating === null) return 'Unrated';
  return markedRating(standing.rating, standing.provisional);
}

/**
 * One rating row: the member's own ladder, named by nothing, with this
 * season's standing.
 */
export type RailLadderRow = {
  readonly ladder: Ladder;
  readonly text: string;
  readonly provisional: boolean;
};

/**
 * The member's own ladder's row. A standing kept from an earlier season is no
 * rating this season, so it reads Unrated until they play.
 */
export function railLadderRows(
  standings: readonly MemberStanding[],
  division: RatingDivision,
): readonly RailLadderRow[] {
  return standings
    .filter((standing) => standing.ladder.division === division)
    .map((standing): RailLadderRow => {
      const current = standing.current
        ? standing
        : { ...standing, rating: null, provisional: false, hidden: false };
      return {
        ladder: standing.ladder,
        text: ratingText(current),
        provisional: current.provisional && current.rating !== null,
      };
    });
}

/**
 * The one rating your card shows beside your username: your own ladder's row.
 * None when the read failed, no season is active or you have no ladder, so
 * the card never shows a rating it has no source for (DEC-156).
 */
export const headlineRating = (result: ShellRatings): RailLadderRow | null =>
  result.state === 'ready' && result.division !== null
    ? (railLadderRows(result.standings, result.division)[0] ?? null)
    : null;

/** The headline rating, streamed in: nothing while it reads or when there is none. */
export async function HeadlineRating({
  ratings,
}: {
  readonly ratings: Promise<ShellRatings>;
}) {
  const row = headlineRating(await ratings);
  if (row === null) return null;
  return (
    <>
      <span aria-hidden="true"> · </span>
      <span
        className={cn(
          'font-semibold text-ink tabular-nums',
          row.provisional && provisionalMarkClass,
        )}
        title={row.provisional ? 'Provisional rating' : undefined}
      >
        <span className="sr-only">, rating </span>
        {row.text}
      </span>
    </>
  );
}
