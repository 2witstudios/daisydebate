import Link from 'next/link';
import type { ReactNode } from 'react';
import type { LadderRow as Row } from '../../../features/leaderboard/ladder-view';
import {
  changeText,
  displayName,
  ratingText,
  rankText,
  recordText,
  rowLabel,
} from '../../../features/leaderboard/labels';
import { Badge } from '../../components/badge/badge';
import { cn } from '../../cn';
import {
  ladderColumnClass,
  ladderGridClass,
  moveClass,
  rankClass,
  rowClass,
} from './ladder-row-class';

export type LadderRowProps = {
  readonly row: Row;
  /** A closed season shows its season change, a live one the last seven days. */
  readonly closed: boolean;
};

const numeric = 'tabular-nums';

/** What appears after a pause over a row, or when it takes focus. */
function HoverCard({ row }: { row: Row }): ReactNode {
  if (row.masked || row.username === null) return null;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none invisible absolute top-full left-16 z-10 flex w-rail flex-col gap-2 rounded-lg border border-border-strong bg-surface-raised p-4 text-left opacity-0 shadow-3 transition-opacity delay-500 duration-120 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 max-compact:hidden"
    >
      <span className="min-w-0">
        <span className="block truncate text-base font-bold">{`@${row.username}`}</span>
        <span className="block text-sm text-ink-muted">
          {row.provisional ? 'Provisional' : 'Established'}
        </span>
      </span>
      <span className="flex items-baseline gap-2">
        <span className="font-display text-xl font-bold tabular-nums">
          {row.rating}
        </span>
        <span className="text-sm text-ink-muted tabular-nums">
          {`±${row.range} · ${row.rank === null ? 'Unranked' : `#${row.rank}`}`}
        </span>
      </span>
      <span className="text-sm text-ink-faint">{`${recordText(row)} W–L`}</span>
    </span>
  );
}

function Cells({ row, closed }: LadderRowProps): ReactNode {
  return (
    <>
      <span
        className={cn(
          ladderColumnClass('rank'),
          numeric,
          'font-display text-lg font-bold',
          rankClass(row.rank),
        )}
      >
        {rankText(row)}
      </span>
      <span
        className={cn(
          ladderColumnClass('name'),
          'flex items-center gap-3 text-left',
        )}
      >
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2">
            <span
              className={cn(
                'truncate font-strong',
                row.username === null && 'text-ink-faint',
              )}
            >
              {displayName(row)}
            </span>
            {row.me ? <Badge tone="accent">You</Badge> : null}
          </span>
          <span className="hidden text-sm text-ink-muted tabular-nums max-compact:block">
            {row.masked ? 'Hidden' : recordText(row)}
          </span>
        </span>
      </span>
      <span
        className={cn(
          ladderColumnClass('rating'),
          numeric,
          'font-display text-lg font-bold max-compact:text-right',
        )}
      >
        {ratingText(row)}
      </span>
      <span
        className={cn(ladderColumnClass('record'), numeric, 'text-ink-muted')}
      >
        {row.masked ? '–' : recordText(row)}
      </span>
      <span
        className={cn(
          ladderColumnClass('move'),
          numeric,
          'text-sm font-strong max-compact:text-right',
          moveClass(row.change.kind),
        )}
      >
        {changeText(row.change, closed)}
      </span>
    </>
  );
}

/**
 * One debater on the ladder, a single link that opens the detail. A deleted
 * account keeps its rating but is not a link.
 */
export function LadderRow({ row, closed }: LadderRowProps) {
  const className = cn(
    ladderGridClass,
    'group relative',
    rowClass({ selected: row.selected, me: row.me }),
  );
  return (
    <li className="border-t border-border">
      {row.href === null ? (
        <div className={className}>
          <Cells row={row} closed={closed} />
        </div>
      ) : (
        <Link
          href={row.href}
          aria-label={rowLabel(row)}
          aria-current={row.selected ? 'true' : undefined}
          className={className}
        >
          <Cells row={row} closed={closed} />
          <HoverCard row={row} />
        </Link>
      )}
    </li>
  );
}
