import { Fragment } from 'react';
import { sourceLabel } from '../../../features/tab/settings';
import type { StandingsTable as Read } from '../../../features/tab/standings';
import type { EventSwitch } from '../../../features/tab/setup';
import type { TimelineRail } from '../../../features/tab/tournament';
import { PageHeader } from '../../components/page-header/page-header';
import { ActionButton, ActionLink } from '../action-control/action-control';
import { EventSwitcher } from '../event-switcher/event-switcher';
import { HostShell } from '../host-shell/host-shell';
import { StandingsTable } from './standings-table';

const sentence = (text: string) =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** Standings and the break, with the tiebreak order and where it is set. */
export function HostStandings({
  rail,
  event,
  table,
}: {
  readonly rail: TimelineRail;
  readonly event: EventSwitch;
  readonly table: Read;
}) {
  return (
    <HostShell rail={rail} current="break">
      <EventSwitcher event={event} />
      <PageHeader
        title={table.title}
        lede={table.lede}
        actions={
          table.announce === null ? undefined : (
            <ActionButton action={table.announce} />
          )
        }
      />
      <p className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm">
        Ties are broken by{' '}
        {table.tiebreakOrder.map((tiebreak, index) => (
          <Fragment key={tiebreak}>
            {index === 0 ? null : ', then '}
            <strong className="font-strong">{tiebreak}</strong>
          </Fragment>
        ))}
        . {sentence(sourceLabel(table.tiebreaks))}
        {table.tiebreaks.locked ? '; it can\u2019t be changed here.' : '.'}
      </p>
      <StandingsTable table={table} />
      <p className="text-sm text-ink-muted">
        {table.remaining} more entries. Standings are worked out from the
        results each time; nothing here is typed in.{' '}
        {table.correction === null ? null : (
          <ActionLink action={table.correction} />
        )}
      </p>
    </HostShell>
  );
}
