import type { ReactNode } from 'react';
import { linkTo } from '../../../features/tab/action';
import type {
  IndexPaging,
  IndexRow,
  RowGroup,
} from '../../../features/tab/tournaments-index';
import { cn } from '../../cn';
import { Badge } from '../../components/badge/badge';
import { ActionButton } from '../action-control/action-control';
import { eyebrowClass, ListRow } from '../list-card/list-card';

/** A heading band with its count at the far end: `Sat 21 Nov … 9`. */
export function CountedHeading({
  heading,
  count,
}: {
  readonly heading: ReactNode;
  readonly count: ReactNode;
}) {
  return (
    <h2
      className={cn(
        'flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2',
        eyebrowClass,
      )}
    >
      <span>{heading}</span>
      <span className="tabular-nums">{count}</span>
    </h2>
  );
}

/** One tournament on the phone: its name, one line, and its one way in. */
export function PhoneRow({ row }: { readonly row: IndexRow }) {
  return (
    <ListRow
      title={row.name}
      detail={row.detail}
      trailing={
        <ActionButton action={row.action} about={row.name} size="small" />
      }
    />
  );
}

/** One tournament on the desktop: date, name, events, where, entry, way in. */
function WideRow({ row }: { readonly row: IndexRow }) {
  return (
    <li className="grid grid-cols-6 items-center gap-4 border-b border-border px-4 py-3 last:border-b-0">
      <span className="flex flex-col items-center leading-tight">
        <span className="text-xs font-heavy text-ink-muted uppercase">
          {row.weekday}
        </span>
        <span className="text-lg font-strong tabular-nums">{row.date}</span>
      </span>
      <span className="flex min-w-0 flex-col">
        <strong className="font-strong">{row.name}</strong>
        <span className="text-sm text-ink-muted">{row.owner}</span>
      </span>
      <span className="flex min-w-0 flex-col text-sm">
        <span>{row.events}</span>
        <span className="text-ink-muted">{row.divisions}</span>
      </span>
      <span className="flex min-w-0 flex-col text-sm">
        <span>{row.venue[0]}</span>
        <span className="text-ink-muted">{row.venue[1]}</span>
      </span>
      <span>
        {row.entry.tone === 'open' ? (
          <Badge tone="accent">{row.entry.label}</Badge>
        ) : (
          <span className="text-sm text-ink-muted">{row.entry.label}</span>
        )}
      </span>
      <ActionButton action={row.action} about={row.name} size="small" />
    </li>
  );
}

/** Groups of rows as the phone draws them: by day, each one line a row. */
export function PhoneGroups({
  groups,
}: {
  readonly groups: readonly RowGroup[];
}) {
  return groups.map((group) => (
    <section key={group.heading} aria-label={group.heading}>
      <CountedHeading heading={group.heading} count={group.count} />
      <ul>
        {group.rows.map((row) => (
          <PhoneRow key={row.name} row={row} />
        ))}
      </ul>
    </section>
  ));
}

/** Groups of rows as the desktop draws them: by week, a row in columns. */
export function WideGroups({
  groups,
}: {
  readonly groups: readonly RowGroup[];
}) {
  return groups.map((group) => (
    <section key={group.heading} aria-label={group.heading}>
      <CountedHeading heading={group.heading} count={group.count} />
      <ul>
        {group.rows.map((row) => (
          <WideRow key={row.name} row={row} />
        ))}
      </ul>
    </section>
  ));
}

/** `20 of 128 shown`, and the button for the next page. */
export function Paging({ paging }: { readonly paging: IndexPaging }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
      <span className="text-sm text-ink-muted">{paging.summary}</span>
      {paging.more === null ? null : (
        <ActionButton
          action={linkTo(paging.more.label, paging.more.href)}
          variant="secondary"
          size="small"
        />
      )}
    </div>
  );
}
