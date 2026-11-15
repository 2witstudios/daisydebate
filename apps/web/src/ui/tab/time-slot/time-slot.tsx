import type { TimeSlot as Read } from '../../../features/tab/tab-round';
import type { TimelineRail } from '../../../features/tab/tournament';
import { PageHeader } from '../../components/page-header/page-header';
import { TabLinks } from '../../components/tab-links/tab-links';
import { ActionButton } from '../action-control/action-control';
import { HostShell } from '../host-shell/host-shell';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';
import { mergeRoomNeeds } from '../../../features/tab/room-needs';
import {
  GroupRows,
  SearchableGroups,
} from '../searchable-groups/searchable-groups';
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
        actions={<ActionButton size="small" action={slot.participantView} />}
      />
      <TabLinks label="Events in this slot" tabs={slot.tabs} />
      <ListCard>
        {slot.needsYou.length === 0 ? null : (
          <GroupRows
            group={{
              heading: 'Needs you',
              limit: 4,
              rows: mergeRoomNeeds(slot.needsYou),
            }}
          />
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
      {slot.roomGroups.some((group) => group.rooms.length > 0) ? (
        <SearchableGroups
          label="Find a room, entry or judge"
          statuses={[
            { id: 'waiting', label: 'Waiting' },
            { id: 'live', label: 'Live' },
            { id: 'judging', label: 'Judging' },
            { id: 'finished', label: 'Finished' },
          ]}
          groups={slot.roomGroups.map((group) => ({
            heading:
              group.attention === 'needs_you' ? 'Needs you' : group.attention,
            limit: 3,
            rows: group.rooms.map((room) => ({
              ...room,
              status: group.attention,
            })),
          }))}
        />
      ) : null}
    </HostShell>
  );
}
