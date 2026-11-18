import type { Person } from '@daisy/protocol';
import { ladderLabel } from '../../features/ratings/ladder-labels';
import { markedRating } from '../../features/ratings/provisional-mark';
import { statusLabels } from '../components/presence-dot/status-labels';

type ShownRating = Person['ratings'][number];

/** The account menu's words: a figure, or why there is none (ui-conventions). */
export const ratingText = (rating: ShownRating): string => {
  if (rating.hidden) return 'Hidden while judging';
  if (rating.rating === null) return 'Unrated';
  return rating.provisional ? 'Provisional' : String(rating.rating);
};

/**
 * The rating a card shows: the one on the ladder this person debates on now
 * (ADR 0147), or none while their ladder is unknown.
 */
export const ownLadderRating = (member: Person): ShownRating | null =>
  member.division === null
    ? null
    : (member.ratings.find(
        (rating) => rating.ladder.division === member.division,
      ) ?? null);

/**
 * Their ladder as the card's status line names it, figure first: "1478*
 * Youth – Freestyle", or the ladder alone while hidden from a judge. A member
 * never rated on their ladder shows none: the card names a ladder only where
 * they have played ranked, so a directory card says no more than their record.
 */
export const ladderLine = (member: Person): string | null => {
  const shown = ownLadderRating(member);
  if (shown === null || (!shown.hidden && shown.rating === null)) return null;
  const label = ladderLabel(shown.ladder);
  return shown.hidden
    ? label
    : `${markedRating(shown.rating!, shown.provisional)} ${label}`;
};

/** What a screen reader hears for a person's ladder and rating. */
export const ratingsLabel = (member: Person): string => {
  const shown = ownLadderRating(member);
  return shown === null
    ? 'Unrated'
    : `${ladderLabel(shown.ladder)} ${ratingText(shown)}`;
};

/** Places an overlay beside its row; CSP and policy keep inline styles out of markup. */
export const anchorAt = (top: number) => (element: HTMLElement | null) => {
  element?.style.setProperty('--person-anchor', `${top}px`);
};

/** Name, status with their ladder and rating, and record. */
export function MemberCardBody({ member }: { readonly member: Person }) {
  const ladder = ladderLine(member);
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-ink">
        {member.displayName ?? `@${member.username}`}
      </p>
      {member.displayName === null ? null : (
        <p className="truncate text-xs text-ink-muted">@{member.username}</p>
      )}
      <p className="text-xs text-ink-muted">
        {ladder === null
          ? statusLabels[member.status]
          : `${statusLabels[member.status]} · ${ladder}`}
      </p>
      <p className="text-xs text-ink-muted">
        {`Record ${member.wins}–${member.losses}`}
      </p>
    </div>
  );
}
