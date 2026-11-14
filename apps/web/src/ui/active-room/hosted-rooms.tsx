import type { RoomListEntry } from '@daisy/protocol';
import { roomStatusLabels } from '../../features/rooms/status-labels';
import { Panel } from '../components/panel/panel';
import { MediaPageLink } from '../round-media/media-page-link';

/**
 * The Rooms a member hosts without a seat in them (TAB-6.16). Hosting holds
 * no one, so such a host has no active-Room bar; this list is their way back.
 */
export const hostedWithoutSeat = (
  rooms: readonly RoomListEntry[],
  actorId: string | null,
): readonly RoomListEntry[] =>
  actorId === null
    ? []
    : rooms.filter((room) => room.hostActorId === actorId && !room.seated);

/** "Rooms you host": each Room by title and state, one link back to it. */
export function HostedRooms({
  rooms,
}: {
  readonly rooms: readonly RoomListEntry[];
}) {
  if (rooms.length === 0) return null;
  return (
    <Panel title="Rooms you host">
      <ul className="flex flex-col gap-2">
        {rooms.map((room) => (
          <li key={room.id} className="flex items-baseline gap-2">
            <MediaPageLink href={`/rooms/${room.id}`} className="font-strong">
              {room.title}
            </MediaPageLink>
            <span className="text-sm text-ink-muted">
              {roomStatusLabels[room.status]}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
