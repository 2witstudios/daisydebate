'use client';

import { Button } from '../../components/button/button';
import { Fragment, useState } from 'react';
import {
  judgeSearchOf,
  type JudgeFilter,
} from '../../../features/tab/judge-search';
import { unavailableAction } from '../../../features/tab/action';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';
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
  const [filter, setFilter] = useState<JudgeFilter>({
    query: '',
    status: 'all',
    slotId: judges.defaultSlotId,
  });
  const search = judgeSearchOf(judges, filter);
  const groups = search.groups;
  const short = judges.groups.filter((group) => group.remind !== null);
  const conflicts = judges.groups
    .flatMap((group) => group.judges)
    .filter((judge) => judge.conflict).length;
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
        actions={
          judges.add === null ? null : <ActionButton action={judges.add} />
        }
      />
      <EntriesTabs
        counts={judges.tabs}
        selected="judges"
        entriesHref={entriesHref}
        judgesHref={judgesHref}
      />
      {atScale ? (
        <>
          <ListCard>
            <ListHeading>Needs you</ListHeading>
            <ul>
              {short.length === 0 ? null : (
                <ListRow
                  title={`${short.length} schools owe judges`}
                  detail={short.map((group) => group.name).join(' · ')}
                  trailing={
                    <ActionButton
                      size="small"
                      action={unavailableAction(
                        `Remind ${short.length} coaches`,
                      )}
                    />
                  }
                />
              )}
              {conflicts === 0 ? null : (
                <ListRow
                  title={`${conflicts} judges have a conflict`}
                  trailing={
                    <ActionButton
                      size="small"
                      action={unavailableAction('Review conflicts')}
                    />
                  }
                />
              )}
            </ul>
          </ListCard>
          <section className="overflow-x-auto rounded-lg border border-border bg-surface-raised">
            <h2 className="px-4 py-3 text-sm font-strong">By time slot</h2>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={cell}>Time slot</th>
                  <th className={cell}>Judges needed</th>
                  <th className={cell}>Free</th>
                  <th className={cell}>Placed</th>
                </tr>
              </thead>
              <tbody>
                {judges.slots.map((slot) => (
                  <tr key={slot.id} className="border-t border-border">
                    <th scope="row" className={cell}>
                      {slot.label}
                    </th>
                    <td className={cell}>{slot.needed ?? 'Not shown'}</td>
                    <td className={cell}>{slot.free}</td>
                    <td className={cell}>{slot.placed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
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
            <label className="flex items-center gap-2">
              Time slot
              <select
                aria-label="Time slot"
                value={filter.slotId ?? ''}
                onChange={(event) =>
                  setFilter({ ...filter, slotId: event.currentTarget.value })
                }
              >
                {judges.slots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slot.label}
                  </option>
                ))}
              </select>
            </label>
            <div
              role="group"
              aria-label="Judges by status"
              className="flex flex-wrap gap-2"
            >
              {search.choices.map((choice) => (
                <Button
                  variant="unstyled"
                  key={choice.id}
                  type="button"
                  aria-pressed={filter.status === choice.id}
                  onClick={() => setFilter({ ...filter, status: choice.id })}
                  className={buttonClass(
                    filter.status === choice.id ? 'primary' : 'secondary',
                  )}
                >
                  {choice.label} {choice.count}
                </Button>
              ))}
            </div>
          </div>
        </>
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
      <table aria-label="Judge roster" className="w-full border-collapse">
        <thead>
          <tr className="bg-surface">
            {[
              'Judge',
              ...judges.slots.map((slot) => slot.label),
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
                      key={judges.slots[index]?.id}
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
