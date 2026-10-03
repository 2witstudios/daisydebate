import type { ReactNode } from 'react';
import type { DebaterDetail } from '../../../features/leaderboard/detail';
import type { ResultRow } from '../../../features/leaderboard/history';
import { Badge } from '../../components/badge/badge';
import { cn } from '../../cn';

export const heading =
  'text-xs font-bold tracking-widest text-ink-muted uppercase';
export const resultTone = (up: boolean) =>
  up ? 'text-online' : 'text-ink-muted';

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note: string;
}) {
  return (
    <div className="flex flex-col rounded-md bg-surface-overlay p-3">
      <span className="text-2xs font-bold tracking-wider text-ink-faint uppercase">
        {label}
      </span>
      <span className="font-display text-xl font-bold tabular-nums">
        {value}
      </span>
      <span className="text-xs text-ink-muted tabular-nums">{note}</span>
    </div>
  );
}

export function ResultLine({ row }: { row: ResultRow }) {
  return (
    <li className="flex items-center gap-3 py-2 text-sm">
      <span
        className={cn('w-10 font-strong', resultTone(row.result === 'Won'))}
      >
        {row.result}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {`vs @${row.opponent}`}
        <span className="block text-xs text-ink-faint">{`Debate ${row.game}`}</span>
      </span>
      <span className={cn('tabular-nums', resultTone(row.up))}>
        {row.change}
      </span>
      <span className="w-12 text-right font-strong tabular-nums">
        {row.rating}
      </span>
    </li>
  );
}

/** The four numbers and the established note for a debater with ranked debates. */
export function RatingSummary({
  detail,
  gridClass,
}: {
  readonly detail: Extract<DebaterDetail, { kind: 'player' }>;
  /** The grid's column classes, which differ between a sheet and a page. */
  readonly gridClass: string;
}) {
  return (
    <>
      <div className={cn('grid gap-3', gridClass)}>
        <Stat label="Rating" value={detail.rating} note={detail.range} />
        <Stat label="Rank" value={detail.rank} note={detail.band} />
        <Stat label="Record" value={detail.record} note="W–L" />
        <Stat label="Peak" value={detail.peak} note="this season" />
      </div>
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Badge tone={detail.established ? 'accent' : 'neutral'}>
          {detail.established ? 'Established' : 'Provisional'}
        </Badge>
        {detail.statusNote}
      </p>
    </>
  );
}
