'use client';
import { roomChatContext } from '../../features/messaging/room-community/room-chat-context';
import type { ContextChatLabels } from '../context-chat/chat-labels';
import {
  ContextChat,
  type ContextChatProps,
} from '../context-chat/context-chat';

export type RoomChatProps = Omit<ContextChatProps, 'ownerId'> & {
  readonly roomId: string;
  /**
   * Why this viewer may only read, as the Room view shows it: their judge
   * seat, or no seat in a Youth Room (decision 84). It picks the notice's
   * words; whether the chat is read-only is the hint's and the chat's own.
   */
  readonly reader?: 'judge' | 'spectator' | null;
};
/** Why the composer is missing, in words that name a seat, never an age. */
const readOnlyNotices = {
  judge: 'Judges read this chat but don’t post in it.',
  spectator: 'Only people in this Room can chat here.',
  other: 'This chat is read-only.',
} as const;
const labelsOf = (notice: string): ContextChatLabels => ({
  region: 'Room chat',
  heading: 'Room chat',
  audience: null,
  composer: 'Message everyone in the room',
  readOnly: { notice, composer: 'none' },
  unnamedAuthor: 'A member',
  messages: 'Room chat messages',
  idPrefix: 'room-chat',
});
const labels = {
  judge: labelsOf(readOnlyNotices.judge),
  spectator: labelsOf(readOnlyNotices.spectator),
  other: labelsOf(readOnlyNotices.other),
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
  reader = null,
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
        retryDiscovery
        labels={labels[reader ?? 'other']}
        authorLabel={authorLabel}
      />
    </div>
  );
}
