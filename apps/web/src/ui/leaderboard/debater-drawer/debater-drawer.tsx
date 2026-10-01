import Link from 'next/link';
import type { ReactNode } from 'react';
import type { DebaterDetail } from '../../../features/leaderboard/detail';
import type { ResultRow } from '../../../features/leaderboard/history';
import {
  closeDetailHref,
  viewHref,
  type LadderQuery,
} from '../../../features/leaderboard/query';
import { Avatar } from '../../components/avatar/avatar';
import { Badge } from '../../components/badge/badge';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { RatingChart } from '../rating-chart/rating-chart';
import { Segmented } from '../segmented/segmented';

export type DebaterDrawerProps = {
  readonly detail: DebaterDetail;
  readonly query: LadderQuery;
};

const heading = 'text-xs font-bold tracking-widest text-ink-muted uppercase';
const resultTone = (up: boolean) => (up ? 'text-online' : 'text-ink-muted');

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

function ResultLine({ row }: { row: ResultRow }) {
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

function Header({ detail, query }: DebaterDrawerProps): ReactNode {
  return (
    <header className="flex items-center gap-3">
      <Avatar name={detail.username} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <h2 className="truncate font-display text-xl font-bold">{`@${detail.username}`}</h2>
          {detail.me ? <Badge tone="accent">You</Badge> : null}
        </div>
        <span className="text-sm text-ink-muted">{detail.subtitle}</span>
      </div>
      <Link
        href={closeDetailHref(query)}
        aria-label="Close detail"
        className="flex size-10 items-center justify-center rounded-sm text-ink-muted no-underline hover:text-ink hover:no-underline"
      >
        <span aria-hidden="true" className="text-xl leading-none">
          ×
        </span>
      </Link>
    </header>
  );
}

function Body({ detail, query }: DebaterDrawerProps): ReactNode {
  if (detail.kind === 'hidden')
    return (
      <p className="flex items-start gap-3 rounded-md bg-surface-overlay p-4 text-base text-ink-muted">
        <Icon name="eye" size={20} />
        Hidden while you judge. Their rating, rank and history return after you
        submit your ballot.
      </p>
    );
  if (detail.kind === 'none')
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center text-base text-ink-muted">
        <Icon name="chart" size={28} className="text-ink-faint" />
        <p>{detail.text}</p>
        <p className="text-sm text-ink-faint">
          Only ranked debates count toward a rating.
        </p>
      </div>
    );
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
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
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className={heading}>Rating history</h3>
          <Segmented
            label="Chart or table"
            segments={[
              {
                label: 'Chart',
                href: viewHref(query, 'chart'),
                selected: detail.view === 'chart',
              },
              {
                label: 'Table',
                href: viewHref(query, 'table'),
                selected: detail.view === 'table',
              },
            ]}
          />
        </div>
        {detail.view === 'chart' ? (
          <RatingChart
            chart={detail.chart}
            label={detail.chartLabel}
            initialStep={detail.step}
            readouts={detail.readouts}
          />
        ) : (
          <table className="w-full text-sm tabular-nums">
            <caption className="sr-only">
              Every ranked debate, newest first
            </caption>
            <thead className="text-2xs tracking-wider text-ink-faint uppercase">
              <tr>
                <th scope="col" className="py-1 text-left font-bold">
                  Debate
                </th>
                <th scope="col" className="py-1 text-left font-bold">
                  Result
                </th>
                <th scope="col" className="py-1 text-left font-bold">
                  Opponent
                </th>
                <th scope="col" className="py-1 text-right font-bold">
                  Change
                </th>
                <th scope="col" className="py-1 text-right font-bold">
                  Rating
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.results.map((row) => (
                <tr key={row.game} className="border-t border-border">
                  <td className="py-1">{row.game}</td>
                  <td className="py-1">{row.result}</td>
                  <td className="max-w-0 truncate py-1">{`@${row.opponent}`}</td>
                  <td className={cn('py-1 text-right', resultTone(row.up))}>
                    {row.change}
                  </td>
                  <td className="py-1 text-right font-strong">{row.rating}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="flex flex-col gap-1">
        <h3 className={heading}>Recent results</h3>
        <ul className="divide-y divide-border">
          {detail.recent.map((row) => (
            <ResultLine key={row.game} row={row} />
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-1">
        <h3 className={heading}>Seasons played</h3>
        <ul className="divide-y divide-border">
          {detail.seasons.map((row) => (
            <li
              key={row.label}
              className={cn(
                'grid grid-cols-12 items-center gap-3 py-2 text-sm tabular-nums',
                row.current ? 'font-strong' : 'text-ink-muted',
              )}
            >
              <span className="col-span-4">{row.label}</span>
              <span className="col-span-2 text-right">{row.rating}</span>
              <span className="col-span-4 text-right">{row.rank}</span>
              <span className="col-span-2 text-right">{row.record}</span>
            </li>
          ))}
        </ul>
      </section>
      <Link href={detail.profileHref} className="text-base font-strong">
        View full profile
      </Link>
    </>
  );
}

/**
 * The debater's detail: a side sheet over the ladder, opened by the row's
 * link and closed by a link back to the same ladder, so it works with no
 * script. The scrim is a link too.
 */
export function DebaterDrawer(props: DebaterDrawerProps) {
  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <Link
        href={closeDetailHref(props.query)}
        aria-label="Close detail"
        tabIndex={-1}
        className="absolute inset-0 bg-scrim/60"
      />
      <aside
        aria-label="Debater detail"
        className="relative flex h-full w-full max-w-search flex-col gap-5 overflow-y-auto bg-surface p-6 shadow-3 max-compact:mt-topbar max-compact:h-auto max-compact:max-w-none max-compact:rounded-t-xl max-compact:p-4"
      >
        <Header {...props} />
        <Body {...props} />
      </aside>
    </div>
  );
}
