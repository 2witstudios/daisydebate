import type { SeasonRow } from '../../../features/tab/league';

/** A league's season table: place, entry and points from certified results. */
export function SeasonStandings({
  rows,
}: {
  readonly rows: readonly SeasonRow[];
}) {
  return (
    <ol>
      {rows.map((row) => (
        <li
          key={row.place}
          className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
        >
          <span className="text-ink-muted tabular-nums">{row.place}</span>
          <strong className="min-w-0 flex-1 font-strong">{row.entry}</strong>
          <span className="text-sm text-ink-muted tabular-nums">
            {row.points} points
          </span>
        </li>
      ))}
    </ol>
  );
}
