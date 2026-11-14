import type { SeasonRow } from '../../../features/tab/league';
import { cn } from '../../cn';

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
          aria-current={row.you ? 'true' : undefined}
          className={cn(
            'flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0',
            row.you && 'bg-hue-teal-soft',
          )}
        >
          <span className="w-6 text-ink-muted tabular-nums">{row.place}</span>
          <span className="min-w-0 flex-1">
            <strong className="font-strong">{row.name}</strong>
            <span className="text-ink-muted"> · {row.school}</span>
          </span>
          <span className="text-sm text-ink-muted tabular-nums">
            {row.points} points
          </span>
        </li>
      ))}
    </ol>
  );
}
