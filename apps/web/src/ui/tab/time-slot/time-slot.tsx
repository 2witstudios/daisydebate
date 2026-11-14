import type { TimeSlot as Read } from '../../../features/tab/tab-round';
import type { TimelineRail } from '../../../features/tab/tournament';
import { PageHeader } from '../../components/page-header/page-header';
import { TabLinks } from '../../components/tab-links/tab-links';
import { ActionButton, ActionLink } from '../action-control/action-control';
import { HostShell } from '../host-shell/host-shell';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';
import { AttentionRows } from '../running-round/attention-list';

/** One time slot across every event that shares it. */
export function TimeSlot({
  rail,
  current,
  slot,
}: {
  readonly rail: TimelineRail;
  readonly current: string;
  readonly slot: Read;
}) {
  return (
    <HostShell rail={rail} current={current}>
      <PageHeader
        title={slot.title}
        lede={slot.lede}
        actions={<ActionLink action={slot.participantView} />}
      />
      <TabLinks label="Events in this slot" tabs={slot.tabs} />
      <ListCard>
        {slot.needsYou.length === 0 ? null : (
          <section>
            <ListHeading>Needs you</ListHeading>
            <ul>
              <AttentionRows rooms={slot.needsYou} />
            </ul>
          </section>
        )}
        <section>
          <ListHeading>Events in this slot</ListHeading>
          <ul>
            {slot.events.map((event) => (
              <ListRow
                key={event.slug}
                title={event.name}
                facts={event.note}
                detail={event.detail}
                trailing={
                  <ActionButton action={event.rooms} about={event.name} />
                }
              />
            ))}
          </ul>
        </section>
        {slot.next === null ? null : (
          <section>
            <ListHeading>{slot.next.heading}</ListHeading>
            <ul>
              <AttentionRows rooms={slot.next.items} />
            </ul>
          </section>
        )}
      </ListCard>
    </HostShell>
  );
}
