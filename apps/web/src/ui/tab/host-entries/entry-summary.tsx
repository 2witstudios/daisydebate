'use client';
import { Button } from '../../components/button/button';
import { useState } from 'react';
import { unavailableAction } from '../../../features/tab/action';
import {
  entryStatusLabels,
  type HostEntries,
} from '../../../features/tab/entries';
import {
  entrySearchOf,
  type EntryFilter,
} from '../../../features/tab/entry-search';
import { buttonClass } from '../../components/button/button-class';
import { ActionButton } from '../action-control/action-control';
import {
  GroupRows,
  type SearchRow,
} from '../searchable-groups/searchable-groups';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';

/** Roster status is a person's state, while disclosure and responsibility belong to the adult. */
export function EntrySummary({ entries }: { readonly entries: HostEntries }) {
  const [filter, setFilter] = useState<EntryFilter>({
    query: '',
    status: 'all',
  });
  const search = entrySearchOf(entries, filter);
  const all = entries.groups.flatMap((group) => group.entries);
  const unanswered = all.filter(
    (entry) => entry.status === 'not_answered',
  ).length;
  const guardians = all.filter(
    (entry) => entry.status === 'waiting_guardian',
  ).length;
  const short = entries.groups.filter((group) => group.short);
  const rows = (kind: 'school' | 'guardian' | 'self'): readonly SearchRow[] =>
    search.groups
      .filter((group) => group.kind === kind)
      .flatMap((group) =>
        kind === 'self'
          ? group.entries.map((entry) => ({
              title: entry.name,
              detail: `${entry.facts} · ${entryStatusLabels[entry.status]}`,
              action: null,
            }))
          : [
              {
                title: group.name,
                detail: `${group.enteredBy ?? ''} · ${group.entries.length} entries · ${group.summary}`,
                action: null,
                content: (
                  <ul>
                    {group.entries.map((entry) => (
                      <ListRow
                        key={entry.name}
                        title={entry.name}
                        detail={entry.facts}
                        trailing={
                          <span className="text-sm font-strong">
                            {entryStatusLabels[entry.status]}
                          </span>
                        }
                      />
                    ))}
                  </ul>
                ),
              },
            ],
      );
  return (
    <>
      <ListCard>
        <ListHeading>Needs you</ListHeading>
        <ul>
          {unanswered === 0 ? null : (
            <ListRow
              title={`${unanswered} entries haven't answered`}
              trailing={
                <ActionButton
                  size="small"
                  action={unavailableAction(`Remind the ${unanswered}`)}
                />
              }
            />
          )}
          {short.length === 0 ? null : (
            <ListRow
              title={`${short.length} schools owe judges`}
              detail={short.map((group) => group.name).join(' · ')}
              trailing={
                <ActionButton
                  size="small"
                  action={unavailableAction(`Remind ${short.length} coaches`)}
                />
              }
            />
          )}
          {guardians === 0 ? null : (
            <ListRow
              title={`${guardians} entries wait on a guardian`}
              trailing={
                <ActionButton
                  size="small"
                  action={unavailableAction(`Remind ${guardians} guardians`)}
                />
              }
            />
          )}
        </ul>
      </ListCard>
      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          aria-label="Find an entry, school or adult"
          placeholder="Find an entry, school or adult"
          value={filter.query}
          onChange={(event) =>
            setFilter({ ...filter, query: event.currentTarget.value })
          }
          maxLength={80}
          className="min-h-12 grow rounded-sm border border-border bg-surface-raised px-3"
        />
        <div
          role="group"
          aria-label="Entries by status"
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
      <ListCard label="Entry rosters">
        {(['school', 'guardian', 'self'] as const).map((kind, index) => {
          const items = rows(kind);
          return items.length === 0 ? null : (
            <GroupRows
              key={kind}
              group={{
                heading: ['Schools', 'Families', 'Entered alone'][index] ?? '',
                limit:
                  filter.query !== '' || filter.status !== 'all'
                    ? items.length
                    : kind === 'school'
                      ? 8
                      : kind === 'guardian'
                        ? 2
                        : 0,
                rows: items,
              }}
            />
          );
        })}
        {search.groups.length === 0 ? (
          <p className="px-4 py-3">No matches</p>
        ) : null}
      </ListCard>
    </>
  );
}
