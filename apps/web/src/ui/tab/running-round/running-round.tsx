import type { RunningRound as Read } from '../../../features/tab/tab-round';
import type { TimelineRail } from '../../../features/tab/tournament';
import { PageHeader } from '../../components/page-header/page-header';
import { ActionButton } from '../action-control/action-control';
import { EventSwitcher } from '../event-switcher/event-switcher';
import { HostShell } from '../host-shell/host-shell';
import { ListCard } from '../list-card/list-card';
import {
  GroupRows,
  SearchableGroups,
} from '../searchable-groups/searchable-groups';
import { attentionHeading } from './attention-list';
import { mergeRoomNeeds } from '../../../features/tab/room-needs';

/** One published tab round: its Rooms by the attention they need. */
export function RunningRound({
  rail,
  current,
  round,
}: {
  readonly rail: TimelineRail;
  readonly current: string;
  readonly round: Read;
}) {
  return (
    <HostShell rail={rail} current={current}>
      <EventSwitcher event={round.event} />
      <PageHeader
        title={round.title}
        lede={round.lede}
        actions={
          <>
            <ActionButton
              size="small"
              action={round.participantView}
              className="self-center"
            />
            {round.next === null ? null : <ActionButton action={round.next} />}
          </>
        }
      />
      {round.groups.find((group) => group.attention === 'needs_you')?.rooms
        .length ? (
        <ListCard>
          <GroupRows
            group={{
              heading: 'Needs you',
              limit: 4,
              rows: mergeRoomNeeds(
                round.groups.find((group) => group.attention === 'needs_you')
                  ?.rooms ?? [],
              ),
            }}
          />
        </ListCard>
      ) : null}
      <SearchableGroups
        label="Find a room, entry or judge"
        statuses={[
          { id: 'waiting', label: 'Waiting' },
          { id: 'live', label: 'Live' },
          { id: 'judging', label: 'Judging' },
          { id: 'finished', label: 'Finished' },
        ]}
        groups={round.groups.map((group) => ({
          total: group.count ?? group.rooms.length,
          more: group.more,
          status: group.attention,
          heading:
            group.attention === 'needs_you'
              ? 'Rooms needing attention'
              : attentionHeading({ ...group, count: null }),
          limit: group.attention === 'needs_you' ? 0 : 3,
          rows: group.rooms.map((room) => ({
            ...room,
            status: room.status ?? group.attention,
          })),
        }))}
      />
    </HostShell>
  );
}
