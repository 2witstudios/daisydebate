import { Announcement } from '../components/announcement/announcement';
import type { RoundRatingsView } from '../../features/ratings/read-round';
import {
  markedRating,
  provisionalMarkClass,
} from '../../features/ratings/provisional-mark';
import { cn } from '../cn';

/** A signed rating change as the receipt prints it: "+14", "−12", "0". */
export const signedChange = (change: number): string =>
  change > 0 ? `+${change}` : change < 0 ? `−${-change}` : '0';

/** A posted change, naming no ladder, style or division: "+14". */
export const ladderChangeText = (change: number): string =>
  signedChange(change);

/** Gains read green, losses clay, no change quiet. */
export const changeToneClass = (change: number): string =>
  change > 0 ? 'text-online' : change < 0 ? 'text-hue-clay' : 'text-ink-muted';

export function RoundRatings({
  view,
}: {
  readonly view: RoundRatingsView | null;
}) {
  if (!view) return null;
  return (
    <section
      aria-label="Round ratings"
      className="flex flex-col gap-3 rounded-xl bg-surface p-4 shadow-1"
    >
      <h2 className="text-base font-bold">{`Ranked · ${view.season}`}</h2>
      {view.posting === 'rated' ? <p>Rated</p> : null}
      {view.posting === 'pending' ? (
        <Announcement as="p" kind="progress">
          Rating update pending
        </Announcement>
      ) : null}
      <dl className="flex flex-wrap gap-6">
        {view.rows.map((row) => {
          const marked = row.provisional && row.rating !== null;
          return (
            <div key={row.label}>
              <dt className="font-strong">{row.label}</dt>
              <dd
                className={cn(
                  'font-display text-3xl font-bold',
                  marked && provisionalMarkClass,
                )}
                title={marked ? 'Provisional rating' : undefined}
              >
                {row.hidden
                  ? 'Hidden while judging'
                  : row.rating === null
                    ? 'Unrated'
                    : markedRating(row.rating, row.provisional)}
                {row.delta === null ? null : (
                  <span
                    className={cn(
                      'font-body text-base font-book not-italic',
                      changeToneClass(row.delta),
                    )}
                  >
                    {` ${ladderChangeText(row.delta)}`}
                  </span>
                )}
              </dd>
              {row.win === null || row.loss === null ? null : (
                <dd className="text-sm text-ink-muted">
                  {`Win ${signedChange(row.win)} · Loss ${signedChange(row.loss)}`}
                </dd>
              )}
            </div>
          );
        })}
      </dl>
    </section>
  );
}
