import type { OnlineMember } from '@daisy/protocol';
import { statusLabels } from '../components/presence-dot/status-labels';

const ladderLabels = {
  freestyle: 'Freestyle',
  policy: 'Policy',
  value: 'Value',
} as const;

/** The account menu's words: a figure, or why there is none (ui-conventions). */
export const ratingText = (rating: OnlineMember['ratings'][number]): string => {
  if (rating.hidden) return 'Hidden while judging';
  if (rating.rating === null) return 'Unrated';
  return rating.provisional ? 'Provisional' : String(rating.rating);
};

/** What a screen reader hears for a person's shown ratings. */
export const ratingsLabel = (member: OnlineMember): string =>
  member.ratings
    .map((rating) => `${ladderLabels[rating.ladder]} ${ratingText(rating)}`)
    .join(', ');

/** Places an overlay beside its row; CSP and policy keep inline styles out of markup. */
export const anchorAt = (top: number) => (element: HTMLElement | null) => {
  element?.style.setProperty('--person-anchor', `${top}px`);
};

/** Name, status, record and the ratings this person shows. */
export function MemberCardBody({ member }: { readonly member: OnlineMember }) {
  return (
    <>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink">
          @{member.username}
        </p>
        <p className="text-xs text-ink-muted">
          {statusLabels[member.status]} · {member.wins}–{member.losses}
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {member.ratings.map((rating) => (
          <div key={rating.ladder}>
            <dt className="text-xs text-ink-muted">
              {ladderLabels[rating.ladder]}
            </dt>
            <dd className="text-sm font-semibold text-ink">
              {ratingText(rating)}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
