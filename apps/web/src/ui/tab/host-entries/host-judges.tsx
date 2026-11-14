'use client';

import { Fragment, useState } from 'react';
import { matchesQuery } from '../../../features/tab/at-scale';
import { buttonClass } from '../../components/button/button-class';
import type {
  HostJudges as Read,
  JudgeSlotState,
} from '../../../features/tab/entries';
import type { TimelineRail } from '../../../features/tab/tournament';
import { cn } from '../../cn';
import { PageHeader } from '../../components/page-header/page-header';
import { ActionButton } from '../action-control/action-control';
import { HostShell } from '../host-shell/host-shell';
import { eyebrowClass } from '../list-card/list-card';
import { EntriesTabs } from './entries-tabs';

/** A slot's cell says where the judge is; only trouble takes a colour. */
export const slotClass = (state: JudgeSlotState): string => {
  switch (state) {
    case 'late':
      return 'font-strong text-live';
    case 'room':
    case 'in_draft':
      return 'text-ink';
    case 'judged':
    case 'away':
    case 'free':
      return 'text-ink-muted';
  }
};

const cell = 'px-3 py-2 text-left align-top text-sm';

/** The judge pool: where each judge is in every time slot, and whom they never judge. */
export function HostJudges({
  rail,
  judges,
  entriesHref,
  judgesHref,
}: {
  readonly rail: TimelineRail;
  readonly judges: Read;
  readonly entriesHref: string;
  readonly judgesHref: string;
}) {
  const [filter, setFilter] = useState({ query: '', status: 'all' });
  const groups = judges.groups
    .map((group) => ({
      ...group,
      judges: group.judges.filter(
        (judge) =>
          matchesQuery(filter.query, [
            judge.name,
            group.name,
            judge.neverJudges,
            judge.clearedFor,
            ...judge.slots.map((slot) => slot.label),
          ]) &&
          (filter.status === 'all' ||
            (filter.status === 'conflict'
              ? judge.conflict
              : filter.status === 'free'
                ? judge.slots.some((slot) => slot.state === 'free')
                : judge.slots.some((slot) => slot.state === 'late'))),
      ),
    }))
    .filter((group) => group.judges.length > 0);
  const atScale = judges.tabs.judges > 20;
  const groupLimit =
    atScale && filter.query === '' && filter.status === 'all'
      ? 3
      : groups.length;
  return (
    <HostShell rail={rail} current="entries">
      <PageHeader
        title="Entries"
        lede={judges.lede}
        actions={<ActionButton action={judges.add} />}
      />
      <EntriesTabs
        counts={judges.tabs}
        selected="judges"
        entriesHref={entriesHref}
        judgesHref={judgesHref}
      />
      {atScale ? (
        <div className="flex flex-wrap gap-3">
          <input
            type="search"
            aria-label="Find a judge or school"
            placeholder="Find a judge or school"
            value={filter.query}
            onChange={(event) =>
              setFilter({ ...filter, query: event.currentTarget.value })
            }
            className="min-h-12 rounded-sm border border-border bg-surface-raised px-3"
          />
          <select
            aria-label="Judges by status"
            value={filter.status}
            onChange={(event) =>
              setFilter({ ...filter, status: event.currentTarget.value })
            }
          >
            <option value="all">All {judges.tabs.judges}</option>
            <option value="free">Free in a time slot</option>
            <option value="conflict">Has a conflict</option>
            <option value="late">Ballot overdue</option>
          </select>
        </div>
      ) : null}
      <JudgeTable judges={judges} groups={groups.slice(0, groupLimit)} />
      {groups.length > groupLimit ? (
        <details>
          <summary className={buttonClass('secondary')}>
            {groups.length - groupLimit} more groups · Show all{' '}
            {judges.tabs.judges} judges
          </summary>
          <JudgeTable judges={judges} groups={groups.slice(groupLimit)} />
        </details>
      ) : null}
    </HostShell>
  );
}

function JudgeTable({
  judges,
  groups,
}: {
  readonly judges: Read;
  readonly groups: Read['groups'];
}) {
  const columns = judges.slots.length + 4;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface-raised">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-surface">
            {[
              'Judge',
              ...judges.slots,
              'Cleared for',
              'Judged',
              'Never judges',
            ].map((heading) => (
              <th key={heading} scope="col" className={cn(cell, eyebrowClass)}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.name}>
              <tr className="border-t border-border bg-surface">
                <th
                  scope="rowgroup"
                  colSpan={columns}
                  className={cn(cell, 'font-book')}
                >
                  <span className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                      <strong className="font-strong">{group.name}</strong> ·{' '}
                      <span
                        className={
                          group.remind === null ? '' : 'font-strong text-live'
                        }
                      >
                        {group.summary}
                      </span>
                    </span>
                    {group.remind === null ? null : (
                      <ActionButton action={group.remind} about={group.name} />
                    )}
                  </span>
                </th>
              </tr>
              {group.judges.map((judge) => (
                <tr
                  key={judge.name}
                  className={cn(
                    'border-t border-border',
                    judge.conflict && 'bg-surface-sunken',
                  )}
                >
                  <th
                    scope="row"
                    className={cn(cell, 'font-strong whitespace-nowrap')}
                  >
                    {judge.name}
                  </th>
                  {judge.slots.map((slot, index) => (
                    <td
                      key={judges.slots[index]}
                      className={cn(cell, slotClass(slot.state))}
                    >
                      {slot.label}
                    </td>
                  ))}
                  <td className={cell}>{judge.clearedFor}</td>
                  <td className={cn(cell, 'tabular-nums')}>{judge.judged}</td>
                  <td className={cn(cell, judge.conflict && 'font-strong')}>
                    {judge.neverJudges}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
          {judges.more === null ? null : (
            <tr className="border-t border-border">
              <td colSpan={columns} className={cell}>
                <ActionButton size="small" action={judges.more} />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
