import { systemId } from '@daisy/clock';
import type { RoomChatProps } from '../../../../../ui/room-chat/room-chat';
import {
  discoverRoomChat,
  sendRoomChatMessageAction,
  mutateRoomChatMessageAction,
  reportRoomChatMessageAction,
} from './actions';

/**
 * The Room page's chat, or null when this viewer has no authority over it (the
 * Room is not theirs to read, or it has started or closed). Props carry no
 * authority or content: every client entry uses the canonical gate. Discovery
 * is a read and never opens the chat. A discovery that fails for any other
 * reason must not take down the Room page, so the thread is still given and
 * offers its own retry.
 */
export async function roomChatProps(
  roomId: string,
  actorId: string,
  socketUrl: string | null,
): Promise<RoomChatProps | null> {
  let discovered: string | null = null;
  try {
    const response = await discoverRoomChat(roomId);
    if (response.status === 403 || response.status === 404) return null;
    discovered = response.headers.get('x-realtime-socket-url');
  } catch {
    discovered = null;
  }
  return {
    roomId,
    actorId,
    socketUrl: socketUrl ?? discovered,
    requestId: systemId.next(),
    readOnlyHint: false,
    sendAction: sendRoomChatMessageAction.bind(null, roomId),
    mutateAction: mutateRoomChatMessageAction.bind(null, roomId),
    reportAction: reportRoomChatMessageAction.bind(null, roomId),
  };
}
