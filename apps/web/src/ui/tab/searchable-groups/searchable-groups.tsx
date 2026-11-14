'use client';

import { useState, type ReactNode } from 'react';
import { collapsed } from '../../../features/tab/at-scale';
import type { TabAction } from '../../../features/tab/action';
import { matchesQuery } from '../../../features/tab/at-scale';
import { buttonClass } from '../../components/button/button-class';
import { ActionButton } from '../action-control/action-control';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';

export type SearchRow = {
  readonly title: string;
  readonly detail: string;
  readonly action: TabAction | null;
  readonly status?: string;
  readonly statuses?: readonly string[];
  readonly content?: ReactNode;
  readonly words?: readonly string[];
};
export type SearchGroup = {
  readonly heading: string;
  readonly rows: readonly SearchRow[];
  readonly limit: number;
};

/** A disclosure keeps the whole read available without a page full of rows. */
export function GroupRows({ group }: { readonly group: SearchGroup }) {
  const rows = (items: readonly SearchRow[]) =>
    items.map((row) =>
      row.content === undefined ? (
        <ListRow
          key={`${row.title} ${row.detail}`}
          title={row.title}
          detail={row.detail}
          trailing={
            row.action === null ? null : (
              <ActionButton
                size="small"
                action={row.action}
                about={row.title}
              />
            )
          }
        />
      ) : (
        <li key={row.title} className="border-b border-border px-4 py-3">
          <details>
            <summary className={buttonClass('secondary')}>
              {row.title} · Open
            </summary>
            <p className="text-sm text-ink-muted">{row.detail}</p>
            {row.content}
          </details>
        </li>
      ),
    );
  const folded = collapsed(group.rows, { limit: group.limit, open: false });
  const cut = folded.rest > 0;
  return (
    <section>
      <ListHeading>
        {group.heading} · {group.rows.length}
      </ListHeading>
      <ul>{rows(folded.shown)}</ul>
      {cut ? (
        <details className="border-t border-border px-4 py-3">
          <summary className={buttonClass('secondary')}>
            {group.rows.length - group.limit} more · Show all{' '}
            {group.rows.length}
          </summary>
          <ul>{rows(group.rows.slice(group.limit))}</ul>
        </details>
      ) : null}
    </section>
  );
}

/** Search and status choices operate over the complete sample read. */
export function SearchableGroups({
  groups,
  label,
  statuses = [],
  groupLimit,
}: {
  readonly groups: readonly SearchGroup[];
  readonly label: string;
  readonly groupLimit?: number;
  readonly statuses?: readonly {
    readonly id: string;
    readonly label: string;
  }[];
}) {
  const [filter, setFilter] = useState({ query: '', status: 'all' });
  const found = groups.map((group) => ({
    ...group,
    rows: group.rows.filter((row) =>
      matchesQuery(filter.query, [row.title, row.detail, ...(row.words ?? [])]),
    ),
  }));
  const count = (status: string) =>
    found
      .flatMap((group) => group.rows)
      .filter(
        (row) =>
          status === 'all' ||
          row.status === status ||
          row.statuses?.includes(status) === true,
      ).length;
  const shown = found
    .map((group) => ({
      ...group,
      rows: group.rows.filter(
        (row) =>
          filter.status === 'all' ||
          row.status === filter.status ||
          row.statuses?.includes(filter.status) === true,
      ),
    }))
    .filter((group) => group.rows.length > 0);
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <label className="flex grow flex-col gap-1">
          <span className="sr-only">{label}</span>
          <input
            type="search"
            aria-label={label}
            placeholder={label}
            maxLength={80}
            value={filter.query}
            onChange={(event) =>
              setFilter({ ...filter, query: event.currentTarget.value })
            }
            className="min-h-12 rounded-sm border border-border bg-surface-raised px-3 text-sm"
          />
        </label>
        {statuses.length === 0 ? null : (
          <div
            role="group"
            aria-label="Filter by status"
            className="flex flex-wrap gap-2"
          >
            {[{ id: 'all', label: 'All' }, ...statuses].map((status) => (
              <button
                key={status.id}
                type="button"
                aria-pressed={filter.status === status.id}
                onClick={() => setFilter({ ...filter, status: status.id })}
                className={buttonClass(
                  filter.status === status.id ? 'primary' : 'secondary',
                )}
              >
                {status.label} {count(status.id)}
              </button>
            ))}
          </div>
        )}
      </div>
      {shown.length === 0 ? (
        <p>No matches</p>
      ) : (
        <ListCard>
          {shown
            .slice(
              0,
              filter.query !== '' || groupLimit === undefined
                ? shown.length
                : groupLimit,
            )
            .map((group) => (
              <GroupRows
                key={group.heading}
                group={{
                  ...group,
                  limit:
                    filter.query === '' && filter.status === 'all'
                      ? group.limit
                      : group.rows.length,
                }}
              />
            ))}
          {filter.query === '' &&
          groupLimit !== undefined &&
          shown.length > groupLimit ? (
            <details>
              <summary className={buttonClass('secondary')}>
                {shown.length - groupLimit} more schools · Show all{' '}
                {shown.length}
              </summary>
              {shown.slice(groupLimit).map((group) => (
                <GroupRows key={group.heading} group={group} />
              ))}
            </details>
          ) : null}
        </ListCard>
      )}
    </>
  );
}
