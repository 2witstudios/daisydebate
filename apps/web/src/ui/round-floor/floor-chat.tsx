'use client';
import { roundFloorContext } from '../../features/messaging/round-floor/floor-context';
import type { ContextChatLabels } from '../context-chat/chat-labels';
import {
  ContextChat,
  type ContextChatProps,
} from '../context-chat/context-chat';

export type FloorChatProps = Omit<ContextChatProps, 'ownerId'> & {
  readonly roundId: string;
};
const labels: ContextChatLabels = {
  region: 'Round floor chat',
  heading: 'Debaters and host',
  audience: 'The host can read this chat.',
  composer: 'Message debaters and host',
  readOnly: { notice: 'This Round chat is read-only.', composer: 'locked' },
  messages: 'Floor messages',
  idPrefix: 'floor',
};
/** The Round's floor chat: the shared thread under the floor's address and words. */
export function FloorChat({
  roundId,
  ...props
}: FloorChatProps & {
  readonly active?: boolean;
  readonly onUnread?: ((count: number) => void) | undefined;
}) {
  return (
    <ContextChat
      {...props}
      ownerId={roundId}
      context={roundFloorContext}
      labels={labels}
    />
  );
}
