import { isNamedSeat, type RoomView } from '@daisy/protocol';
import { roomCommunitySeatReadsOnly } from '@daisy/protocol/room-community';

/**
 * Whether this viewer's own seat reads Room chat without posting, as the Room
 * view shows it. Only a hint for a chat nobody has opened yet, so that a
 * judge's page does not ask to open one; the chat's own authority decides
 * every request.
 */
export const readsRoomChatOnly = (
  view: Pick<RoomView, 'participants'>,
  actorId: string,
): boolean =>
  roomCommunitySeatReadsOnly(
    view.participants
      .filter(isNamedSeat)
      .find((seat) => seat.actorId === actorId)?.role ?? null,
  );
