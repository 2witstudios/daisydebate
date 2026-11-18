import type { ReactNode } from 'react';
import type {
  EntryStatus,
  HostEntries as Read,
} from '../../../features/tab/entries';
import type { TimelineRail } from '../../../features/tab/tournament';
import { EntrySummary } from './entry-summary';
import { cn } from '../../cn';
import { PageHeader } from '../../components/page-header/page-header';
import { ActionButton } from '../action-control/action-control';
import { EventSwitcher } from '../event-switcher/event-switcher';
import { HostShell } from '../host-shell/host-shell';
import { ListCard, ListRow } from '../list-card/list-card';
import { EntriesTabs } from './entries-tabs';

const statusLabels: Readonly<Record<EntryStatus, string>> = {
  accepted: 'Accepted',
  not_answered: 'Not answered',
  waiting_guardian: 'Waiting on a guardian',
  withdrawn: 'Withdrawn',
};

/** Every entry, grouped by the responsible adult who answers for it. */
export function HostEntries({
  rail,
  entries,
  entriesHref,
  judgesHref,
  obligationEditor,
  notice,
}: {
  readonly rail: TimelineRail;
  readonly entries: Read;
  readonly entriesHref: string;
  readonly judgesHref: string;
  readonly obligationEditor?: ReactNode;
  /** A status panel under the header: the hosting tier's entry limit (ADR 0147). */
  readonly notice?: ReactNode;
}) {
  return (
    <HostShell rail={rail} current="entries">
      <EventSwitcher event={entries.event} />
      <PageHeader
        title="Entries"
        lede={entries.lede}
        actions={entries.actions.map((action) => (
          <ActionButton key={action.label} action={action} />
        ))}
      />
      {notice}
      <EntriesTabs
        counts={entries.tabs}
        selected="debaters"
        entriesHref={entriesHref}
        judgesHref={judgesHref}
      />
      {entries.groups.length > 10 ? (
        <EntrySummary entries={entries} />
      ) : (
        <ListCard>
          {entries.groups.map((group) => (
            <section key={group.name}>
              <h2 className="flex flex-wrap justify-between gap-x-4 border-b border-border bg-surface px-4 py-2 text-sm">
                <span>
                  <strong className="font-strong">{group.name}</strong>
                  {group.enteredBy === null
                    ? null
                    : ` · entered by ${group.enteredBy}`}
                </span>
                <span
                  className={cn(
                    group.short ? 'font-strong text-live' : 'text-ink-muted',
                  )}
                >
                  {group.summary}
                </span>
              </h2>
              <ul>
                {group.entries.map((entry) => (
                  <ListRow
                    key={entry.name}
                    title={entry.name}
                    facts={entry.facts}
                    trailing={
                      <span
                        className={cn(
                          'text-sm font-strong',
                          entry.status === 'accepted'
                            ? 'text-accent'
                            : 'text-live',
                        )}
                      >
                        {statusLabels[entry.status]}
                      </span>
                    }
                  />
                ))}
                {group.more === null ? null : (
                  <li className="border-b border-border px-4 py-3 last:border-b-0">
                    <ActionButton size="small" action={group.more} />
                  </li>
                )}
              </ul>
            </section>
          ))}
        </ListCard>
      )}
      <p className="text-sm text-ink-muted">{entries.note}</p>
      {obligationEditor}
    </HostShell>
  );
}
