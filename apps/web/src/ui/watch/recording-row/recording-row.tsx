import Link from 'next/link';
import type { RecordingRow as RowModel } from '../../../features/watch/recording-row';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { modeTextClass } from '../live-card/live-card-class';

export type RecordingRowProps = {
  readonly row: RowModel;
};

/** The archive's shared column grid: the header and every row use it. */
export const recordingGridClass =
  'grid grid-cols-12 items-center gap-x-5 max-compact:grid-cols-3 max-compact:gap-x-3';

function Player({ seat }: { seat: RowModel['aff'] }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-ink">{seat.name}</span>
      <span className="text-sm text-ink-faint tabular-nums">
        {String(seat.rating)}
      </span>
    </span>
  );
}

/** One recording: what it was, who played, the result and one Replay link. */
export function RecordingRow({ row }: RecordingRowProps) {
  return (
    <li
      className={cn(
        recordingGridClass,
        'min-h-16 border-t border-border px-5 py-3 max-compact:px-4',
      )}
    >
      <div className="col-span-5 flex min-w-0 flex-col gap-1 max-compact:col-span-2">
        <p className="truncate text-md font-strong text-ink">{row.title}</p>
        <p className="text-sm text-ink-muted">
          <span className={modeTextClass(row.ranked)}>{row.mode}</span>
          {` · ${row.rules} · ${row.length} · ${row.date}`}
        </p>
        {row.own ? (
          <p className="flex items-center gap-2 text-xs text-ink-faint">
            <Badge tone={row.own.visibility === 'Private' ? 'gold' : 'neutral'}>
              {row.own.visibility}
            </Badge>
            {row.own.keptUntil}
          </p>
        ) : null}
      </div>
      <div className="col-span-3 flex flex-col gap-1 text-base max-compact:col-span-2">
        <Player seat={row.aff} />
        <span className="flex items-baseline gap-2">
          <span className="text-xs text-ink-faint">vs</span>
          <Player seat={row.neg} />
        </span>
      </div>
      <p className="col-span-2 text-sm text-ink-muted max-compact:col-span-2">
        {row.result}
      </p>
      <div className="col-span-2 max-compact:col-span-1 max-compact:col-start-3 max-compact:row-span-3 max-compact:row-start-1">
        <Link
          href={row.href}
          aria-label={`Replay ${row.title}`}
          className={cn(
            buttonClass('secondary'),
            'w-full no-underline hover:no-underline',
          )}
        >
          Replay
        </Link>
      </div>
    </li>
  );
}
