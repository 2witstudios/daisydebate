import Link from 'next/link';
import type { ArchiveEntry } from '../../../features/recording/archive';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';

export type RecordingRowProps = {
  readonly row: ArchiveEntry;
};

/** The archive's shared column grid: the header and every row use it. */
export const recordingGridClass =
  'grid grid-cols-12 items-center gap-x-5 max-compact:grid-cols-3 max-compact:gap-x-3';

const stateLabels = {
  watch: null,
  processing: 'Video being prepared',
  failed: 'Video could not be saved',
  not_recorded: 'Not recorded',
  removed: 'Video no longer available',
  withheld: 'Video being held back',
} as const;

const facts = (row: ArchiveEntry): string =>
  [row.length, row.date, stateLabels[row.media]]
    .filter((fact) => fact !== null)
    .join(' · ');

const action = (row: ArchiveEntry): string =>
  row.media === 'watch' ? 'Replay' : row.transcript ? 'Read' : 'Open';

/** One finished Round: what it was, who debated, the result if permitted, one link. */
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
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
          <Badge tone={row.ranked ? 'clay' : 'sky'}>
            {row.ranked ? 'Ranked' : 'Casual'}
          </Badge>
          {facts(row)}
        </p>
        {row.ownVisibility ? (
          <p className="flex items-center gap-2 text-xs text-ink-faint">
            <Badge tone={row.ownVisibility === 'private' ? 'gold' : 'neutral'}>
              {row.ownVisibility}
            </Badge>
          </p>
        ) : null}
      </div>
      <div className="col-span-3 flex flex-col gap-1 text-base max-compact:col-span-2">
        <span className="text-ink">{row.aff}</span>
        <span className="flex items-baseline gap-2">
          <span className="text-xs text-ink-faint">vs</span>
          <span className="text-ink">{row.neg}</span>
        </span>
      </div>
      <p className="col-span-2 text-sm text-ink-muted max-compact:col-span-2">
        {row.result ?? ''}
      </p>
      <div className="col-span-2 max-compact:col-span-1 max-compact:col-start-3 max-compact:row-span-3 max-compact:row-start-1">
        <Link
          href={row.href}
          aria-label={`${action(row)} ${row.title}`}
          className={cn(
            buttonClass('secondary'),
            'w-full no-underline hover:no-underline',
          )}
        >
          {action(row)}
        </Link>
      </div>
    </li>
  );
}
