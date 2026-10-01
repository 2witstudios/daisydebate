import Link from 'next/link';
import type { LadderRow } from '../../../features/leaderboard/ladder-view';
import {
  bandText,
  changeText,
  displayName,
  ratingText,
  rankText,
  recordText,
  rowLabel,
} from '../../../features/leaderboard/labels';
import { cn } from '../../cn';
import { BloomGlyph } from '../bloom-glyph/bloom-glyph';
import { moveClass } from '../ladder-row/ladder-row-class';

export type PodiumProps = {
  readonly rows: readonly LadderRow[];
  readonly closed: boolean;
};

/** The top three as cards. Each is one link, like a row. */
export function Podium({ rows, closed }: PodiumProps) {
  return (
    <ol
      aria-label="Top three"
      className="grid grid-cols-3 gap-4 max-compact:gap-2"
    >
      {rows.map((row) => (
        <li key={row.key} className="flex">
          <Link
            href={row.href ?? '#'}
            aria-label={rowLabel(row)}
            className={cn(
              'flex min-w-0 flex-1 flex-col gap-3 rounded-lg border bg-surface p-5 text-ink no-underline shadow-1 hover:no-underline max-compact:p-3',
              row.rank === 1 ? 'border-gold-border' : 'border-border',
            )}
          >
            <span className="flex items-center justify-between">
              <span className="font-display text-3xl leading-none font-bold text-gold tabular-nums max-compact:text-2xl">
                {rankText(row)}
              </span>
              <span className="max-compact:hidden">
                <BloomGlyph bloom={row.bloom} size={36} />
              </span>
            </span>
            <span className="truncate font-strong">{displayName(row)}</span>
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-display text-xl font-bold tabular-nums">
                {ratingText(row)}
              </span>
              <span
                className={cn(
                  'text-sm font-strong tabular-nums',
                  moveClass(row.change.kind),
                )}
              >
                {changeText(row.change, closed)}
              </span>
            </span>
            <span className="text-sm text-ink-muted tabular-nums max-compact:hidden">
              {`${bandText(row)} · ${recordText(row)} W–L`}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
