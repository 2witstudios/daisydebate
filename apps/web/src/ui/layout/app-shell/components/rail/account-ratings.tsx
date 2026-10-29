import type { RatingLadder } from '@daisy/protocol';
import type { MemberStanding } from '../../../../../features/ratings/read-member';
import type { ShellRatings } from '../../account';

const ladderNames: Readonly<Record<RatingLadder, string>> = {
  freestyle: 'Freestyle',
  policy: 'Policy',
  value: 'Value',
};

/** What a ladder row shows: the rating, or the state it is in. */
export function ratingText(standing: MemberStanding): string {
  if (standing.hidden) return 'Hidden while judging';
  if (standing.rating === null) return 'Unrated';
  return standing.provisional
    ? `${standing.rating} · Provisional`
    : `${standing.rating}`;
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
        <h2 className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
          Ranked
        </h2>
        <p className="text-sm text-ink-muted">
          Ratings are unavailable right now.
        </p>
      </section>
    );
  }
  const season = result.standings[0]?.season;
  return (
    <section aria-label="Ratings" className="flex flex-col gap-1">
      <h2 className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
        {season ? `Ranked · ${season}` : 'Ranked'}
      </h2>
      {result.standings.length === 0 ? (
        <p className="text-sm text-ink-muted">No season is active.</p>
      ) : (
        <dl className="flex flex-col gap-1">
          {result.standings.map((standing) => (
            <div
              key={standing.ladder}
              className="flex items-baseline justify-between gap-3"
            >
              <dt className="text-sm text-ink-muted">
                {ladderNames[standing.ladder]}
              </dt>
              <dd className="text-sm font-semibold text-ink tabular-nums">
                {ratingText(standing)}
              </dd>
            </div>
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
      <h2 className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
        Ranked
      </h2>
      <p className="sr-only">Loading your ratings</p>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <span className="h-4 rounded-sm bg-surface-overlay" />
        <span className="h-4 rounded-sm bg-surface-overlay" />
        <span className="h-4 rounded-sm bg-surface-overlay" />
      </div>
    </section>
  );
}
