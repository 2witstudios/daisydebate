import { type Person } from '@daisy/protocol/people-list';
import { type RatingDivision } from '@daisy/protocol/ladder';
import { styleLabels } from '../../features/ratings/ladder-labels';
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
const ownLadderRating = (member: Person): ShownRating | null =>
  member.division === null
    ? null
    : (member.ratings.find(
        (rating) => rating.ladder.division === member.division,
      ) ?? null);

/**
 * Their rating as the card's status line shows it, a figure alone: "1478*"
 * (YChallenge). Only for a member of the viewer's own lobby (ADR 0162), and
 * only where they have played ranked and it is not hidden from a judge.
 */
export const ladderLine = (
  member: Person,
  viewer: RatingDivision | null,
): string | null => {
  if ((viewer ?? 'open') !== (member.division ?? 'open')) return null;
  const shown = ownLadderRating(member);
  if (shown === null || shown.hidden || shown.rating === null) return null;
  return markedRating(shown.rating, shown.provisional);
};

/** What a screen reader hears for a person's ladder and rating. */
export const ratingsLabel = (member: Person): string => {
  const shown = ownLadderRating(member);
  return shown === null
    ? 'Unrated'
    : `${styleLabels[shown.ladder.style]} ${ratingText(shown)}`;
};

/** Places an overlay beside its row; CSP and policy keep inline styles out of markup. */
export const anchorAt = (top: number) => (element: HTMLElement | null) => {
  element?.style.setProperty('--person-anchor', `${top}px`);
};

/** Name, status with their rating inside the viewer's lobby, and record. */
export function MemberCardBody({
  member,
  viewer,
}: {
  readonly member: Person;
  /** The viewer's own division (ADR 0147); null with no age on record. */
  readonly viewer: RatingDivision | null;
}) {
  const ladder = ladderLine(member, viewer);
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
