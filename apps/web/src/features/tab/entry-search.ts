import type { EntryListQuery } from '@daisy/protocol/lobby/entry-read';
import { matchesQuery } from './at-scale';
import type { HostEntries } from './entries';
export type EntryFilter = {
  readonly query: string;
  readonly status: EntryListQuery['status'];
};
type Group = HostEntries['groups'][number];
type Entry = Group['entries'][number];
const matchesStatus = (
  entry: Entry,
  group: Group,
  status: EntryFilter['status'],
): boolean => {
  switch (status) {
    case 'all':
      return true;
    case 'accepted':
      return entry.status === 'accepted';
    case 'not_answered':
      return (
        entry.status === 'not_answered' || entry.status === 'waiting_guardian'
      );
    case 'waiting_guardian':
      return entry.status === 'waiting_guardian';
    case 'withdrawn':
      return entry.status === 'withdrawn';
    case 'short':
      return group.short;
  }
};
const entryFilterLabels: Readonly<Record<EntryFilter['status'], string>> = {
  all: 'All',
  accepted: 'Accepted',
  not_answered: 'Not answered',
  waiting_guardian: 'Waiting on a guardian',
  withdrawn: 'Withdrawn',
  short: 'Owing a judge',
};
/** Filter people within their responsible adult's roster, then count people, never roster rows. */
export function entrySearchOf(entries: HostEntries, filter: EntryFilter) {
  const found = entries.groups.map((group) => ({
    ...group,
    entries: group.entries.filter((entry) =>
      matchesQuery(filter.query, [
        group.name,
        group.enteredBy ?? '',
        entry.name,
        entry.facts,
      ]),
    ),
  }));
  const statuses = [
    'all',
    'not_answered',
    'waiting_guardian',
    'withdrawn',
    'short',
  ] as const;
  return {
    choices: statuses.map((status) => ({
      id: status,
      label: entryFilterLabels[status],
      count: found.reduce(
        (sum, group) =>
          sum +
          group.entries.filter((entry) => matchesStatus(entry, group, status))
            .length,
        0,
      ),
    })),
    groups: found
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) =>
          matchesStatus(entry, group, filter.status),
        ),
      }))
      .filter((group) => group.entries.length > 0),
  };
}
