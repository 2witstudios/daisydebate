import type { HostedRoom } from '@daisy/protocol/hosted-rooms';
import { roomStatusLabels } from '../../features/rooms/status-labels';
import { Panel } from '../components/panel/panel';
import { MediaPageLink } from '../round-media/media-page-link';

/**
 * "Rooms you host" (TAB-6.16): the open Rooms a member hosts without a seat
 * in them, each by title and state with one link back. Hosting holds no
 * one, so such a host has no active-Room bar; this list is their way back. A
 * Room they also sit in is reached through that bar instead.
 */
export function HostedRooms({
  rooms,
}: {
  readonly rooms: readonly HostedRoom[];
}) {
  const unseated = rooms.filter((room) => !room.seated);
  if (unseated.length === 0) return null;
  return (
    <Panel title="Rooms you host">
      <ul className="flex flex-col gap-2">
        {unseated.map((room) => (
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
