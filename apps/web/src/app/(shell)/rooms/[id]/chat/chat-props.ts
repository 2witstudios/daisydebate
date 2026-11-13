import { systemId } from '@daisy/clock';
import { parseContextChatDiscovery } from '../../../../../features/messaging/context-chat/view';
import { roomChatContext } from '../../../../../features/messaging/room-community/room-chat-context';
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
 * is a read and never opens the chat. An admitted member's page opens it on
 * entering the Room, with the protected POST; a reader who may not post (a
 * judge) is given a read-only thread that never asks to. A discovery that
 * fails for any other reason must not take down the Room page, so the thread is
 * still given and offers its own retry.
 */
export async function roomChatProps(
  roomId: string,
  actorId: string,
  socketUrl: string | null,
  readsOnly: boolean,
): Promise<RoomChatProps | null> {
  let discovered: string | null = null;
  let readOnlyHint = readsOnly;
  try {
    const response = await discoverRoomChat(roomId);
    if (response.status === 403 || response.status === 404) return null;
    discovered = response.headers.get('x-realtime-socket-url');
    if (response.ok)
      readOnlyHint =
        parseContextChatDiscovery(
          roomChatContext,
          await response.json(),
          roomId,
        )?.channel?.readOnly ?? readsOnly;
  } catch {
    discovered = null;
  }
  return {
    roomId,
    actorId,
    socketUrl: socketUrl ?? discovered,
    requestId: systemId.next(),
    readOnlyHint,
    sendAction: sendRoomChatMessageAction.bind(null, roomId),
    mutateAction: mutateRoomChatMessageAction.bind(null, roomId),
    reportAction: reportRoomChatMessageAction.bind(null, roomId),
  };
}
