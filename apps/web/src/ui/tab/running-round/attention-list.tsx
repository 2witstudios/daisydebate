import type {
  AttentionGroup,
  AttentionRoom,
  RoomAttention,
} from '../../../features/tab/tab-round';
import { ActionButton } from '../action-control/action-control';
import { ListRow } from '../list-card/list-card';

const labels: Readonly<Record<RoomAttention, string>> = {
  needs_you: 'Needs you',
  waiting: 'Waiting',
  live: 'Live now',
  judging: 'Judging',
  finished: 'Finished',
};

/** The heading of one attention group, with its count where the list is cut. */
export const attentionHeading = (group: AttentionGroup): string =>
  group.count === null
    ? labels[group.attention]
    : `${labels[group.attention]} · ${group.count}`;

export function AttentionRows({
  rooms,
}: {
  readonly rooms: readonly AttentionRoom[];
}) {
  return rooms.map((room) => (
    <ListRow
      key={room.title}
      title={room.title}
      detail={room.detail}
      trailing={<ActionButton action={room.action} about={room.title} />}
    />
  ));
}
