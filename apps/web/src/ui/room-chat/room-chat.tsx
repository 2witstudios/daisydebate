'use client';
import { roomChatContext } from '../../features/messaging/room-community/room-chat-context';
import type { ContextChatLabels } from '../context-chat/chat-labels';
import {
  ContextChat,
  type ContextChatProps,
} from '../context-chat/context-chat';

export type RoomChatProps = Omit<ContextChatProps, 'ownerId'> & {
  readonly roomId: string;
};
const labels: ContextChatLabels = {
  region: 'Room chat',
  heading: 'Room chat',
  audience: 'Everyone in the room',
  composer: 'Message everyone in the room',
  messages: 'Room chat messages',
  idPrefix: 'room-chat',
};
/**
 * A Room's chat while it gathers (ADR 0126): the shared thread under the Room's
 * address and words. It fills the height its container gives it. `authorLabel`
 * lets the page say what it may about an author, such as their seat; the chat
 * itself knows only usernames.
 */
export function RoomChat({
  roomId,
  authorLabel,
  ...props
}: RoomChatProps & {
  readonly authorLabel?: ((actorId: string) => string | null) | undefined;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <ContextChat
        {...props}
        ownerId={roomId}
        context={roomChatContext}
        labels={labels}
        authorLabel={authorLabel}
      />
    </div>
  );
}
