import type { Ladder, RatingDivision } from '@daisy/protocol';
import { noLadderReason } from '../../../../../features/play/ladder-division-words';
import {
  divisionAudiences,
  ladderLabel,
} from '../../../../../features/ratings/ladder-labels';
import type { MemberStanding } from '../../../../../features/ratings/read-member';
import {
  markedRating,
  provisionalMarkClass,
} from '../../../../../features/ratings/provisional-mark';
import type { ShellRatings } from '../../account';
import { cn } from '../../../../cn';
import { Icon } from '../../../../components/icon/icon';

/** What a ladder row shows: the rating, or the state it is in. */
export function ratingText(standing: MemberStanding): string {
  if (standing.hidden) return 'Hidden while judging';
  if (standing.rating === null) return 'Unrated';
  return markedRating(standing.rating, standing.provisional);
}

/**
 * One row of the account menu's ratings (ADR 0147): the member's own ladder
 * with this season's standing, or another division's ladder, locked with who
 * it is for. Never an age.
 */
export type RailLadderRow =
  | {
      readonly kind: 'own';
      readonly ladder: Ladder;
      readonly text: string;
      readonly provisional: boolean;
    }
  | {
      readonly kind: 'locked';
      readonly ladder: Ladder;
      readonly audience: string;
    };

/**
 * A row per ladder read, the member's own first. A standing kept from an
 * earlier season is no rating this season, so their own ladder reads
 * Unrated until they play.
 */
export function railLadderRows(
  standings: readonly MemberStanding[],
  division: RatingDivision,
): readonly RailLadderRow[] {
  return standings
    .slice()
    .sort(
      (a, b) =>
        Number(b.ladder.division === division) -
        Number(a.ladder.division === division),
    )
    .map((standing): RailLadderRow => {
      if (standing.ladder.division !== division)
        return {
          kind: 'locked',
          ladder: standing.ladder,
          audience: divisionAudiences[standing.ladder.division],
        };
      const current = standing.current
        ? standing
        : { ...standing, rating: null, provisional: false, hidden: false };
      return {
        kind: 'own',
        ladder: standing.ladder,
        text: ratingText(current),
        provisional: current.provisional && current.rating !== null,
      };
    });
}

/** The season the menu is headed by: the member's own ladder's, if current. */
export const railSeason = (
  standings: readonly MemberStanding[],
  division: RatingDivision | null,
): string | undefined =>
  (
    standings.find((s) => s.current && s.ladder.division === division) ??
    standings.find((s) => s.current)
  )?.season;

const heading = 'text-xs font-semibold tracking-wide text-ink-faint uppercase';

function LadderRow({ row }: { readonly row: RailLadderRow }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-ink-muted">{ladderLabel(row.ladder)}</dt>
      {row.kind === 'own' ? (
        <dd
          className={cn(
            'text-sm font-semibold text-ink tabular-nums',
            row.provisional && provisionalMarkClass,
          )}
          title={row.provisional ? 'Provisional rating' : undefined}
        >
          {row.text}
        </dd>
      ) : (
        <dd className="flex items-center gap-1 text-sm text-ink-muted">
          <Icon name="lock" size={14} />
          {row.audience}
        </dd>
      )}
    </div>
  );
}

/** The member's standing on each ladder, read by the shell for this request. */
export async function AccountRatings({
  ratings,
}: {
  readonly ratings: Promise<ShellRatings>;
}) {
  const result = await ratings;
  if (result.state === 'unavailable') {
    return (
      <section aria-label="Ratings" className="flex flex-col gap-1">
        <h2 className={heading}>Ranked</h2>
        <p className="text-sm text-ink-muted">
          Ratings are unavailable right now.
        </p>
      </section>
    );
  }
  const season = railSeason(result.standings, result.division);
  return (
    <section aria-label="Ratings" className="flex flex-col gap-1">
      <h2 className={heading}>{season ? `Ranked · ${season}` : 'Ranked'}</h2>
      {result.standings.length === 0 ? (
        <p className="text-sm text-ink-muted">No season is active.</p>
      ) : result.division === null ? (
        <p className="text-sm text-ink-muted">{noLadderReason}</p>
      ) : (
        <dl className="flex flex-col gap-1">
          {railLadderRows(result.standings, result.division).map((row) => (
            <LadderRow key={ladderLabel(row.ladder)} row={row} />
          ))}
        </dl>
      )}
    </section>
  );
}

/** The same section while the ratings are still reading. */
export function RatingsSkeleton() {
  return (
    <section
      aria-label="Ratings"
      aria-busy="true"
      className="flex flex-col gap-2"
    >
      <h2 className={heading}>Ranked</h2>
      <p className="sr-only">Loading your ratings</p>
      <span aria-hidden="true" className="h-4 rounded-sm bg-surface-overlay" />
    </section>
  );
}
