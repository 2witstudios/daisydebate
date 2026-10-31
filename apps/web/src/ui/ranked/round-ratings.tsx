import type { RoundRatingsView } from '../../features/ratings/read-round';
import {
  markedRating,
  provisionalMarkClass,
} from '../../features/ratings/provisional-mark';

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
      <h2 className="text-base font-bold">
        {view.ladder[0]!.toUpperCase() + view.ladder.slice(1)} · {view.season}
      </h2>
      {view.pending ? <p role="status">Rating update pending</p> : null}
      <dl className="flex flex-wrap gap-6">
        {view.rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd
              className={
                row.provisional && row.rating !== null
                  ? provisionalMarkClass
                  : undefined
              }
              title={
                row.provisional && row.rating !== null
                  ? 'Provisional rating'
                  : undefined
              }
            >
              {row.hidden
                ? 'Hidden while judging'
                : row.rating === null
                  ? 'Unrated'
                  : markedRating(row.rating, row.provisional)}
              {row.delta === null
                ? ''
                : ` (${row.delta > 0 ? '+' : ''}${row.delta})`}
            </dd>
            {row.win === null || row.loss === null ? null : (
              <dd>
                Win {row.win >= 0 ? '+' : ''}
                {row.win} · Loss {row.loss}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}
