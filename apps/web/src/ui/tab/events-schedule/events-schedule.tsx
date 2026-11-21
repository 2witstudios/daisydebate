import type { ReactNode } from 'react';
import Link from 'next/link';
import type { EventsSchedule as Read } from '../../../features/tab/events';
import type { TimelineRail } from '../../../features/tab/tournament';
import { PageHeader } from '../../components/page-header/page-header';
import { ActionButton } from '../action-control/action-control';
import { HostShell } from '../host-shell/host-shell';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';

/** A tournament's events by the group they run in, with one event's form beside them. */
export function EventsSchedule({
  rail,
  schedule,
  stored,
}: {
  readonly rail: TimelineRail;
  readonly schedule: Read;
  readonly stored: {
    readonly aside: {
      readonly title: string;
      readonly content: ReactNode;
    } | null;
    readonly selectedEventId: string | null;
    readonly schedule: ReactNode;
  };
}) {
  return (
    <HostShell
      rail={rail}
      current="events"
      {...(stored.aside
        ? { asideLabel: stored.aside.title, aside: stored.aside.content }
        : {})}
    >
      <PageHeader
        title="Events and schedule"
        lede={schedule.lede}
        actions={schedule.actions.map((action) => (
          <ActionButton key={action.label} action={action} />
        ))}
      />
      <ListCard>
        {schedule.groups.map((group) => (
          <section key={group.name}>
            <ListHeading>
              {[group.name || 'No time slot', group.times]
                .filter(Boolean)
                .join(' · ')}
            </ListHeading>
            <ul>
              {group.events.map((event) => (
                <ListRow
                  key={event.slug}
                  title={
                    <Link href={event.href} scroll={false} className="text-ink">
                      {event.name}
                    </Link>
                  }
                  detail={event.summary}
                  tone={
                    event.slug === stored.selectedEventId ? 'held' : 'plain'
                  }
                  current={event.slug === stored.selectedEventId}
                />
              ))}
            </ul>
          </section>
        ))}
      </ListCard>
      {schedule.entryLimit.kind === 'unconfigured' ? (
        <p className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm">
          Entry terms are unconfigured.
        </p>
      ) : (
        <p className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm">
          <strong className="font-strong">One person can enter</strong>{' '}
          {schedule.entryLimit.rule}. {schedule.entryLimit.source}
        </p>
      )}
      <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm">
        <p>
          <strong className="font-strong">Judges are one pool.</strong>{' '}
          {schedule.judgePool.kind === 'unconfigured'
            ? 'Judge obligations are unconfigured.'
            : schedule.judgePool.rule}
        </p>
        {schedule.judgePool.action ? (
          <ActionButton size="small" action={schedule.judgePool.action} />
        ) : null}
      </div>
      {stored.schedule}
    </HostShell>
  );
}
