import type { MessagingConversation } from '../conversation';

export type ContextChatMessage = MessagingConversation['messages'][number];

/** Latest revisions replace overlapping older pages; unrelated channels never enter the thread. */
export function mergeContextChatMessages(
  channelId: string,
  older: readonly ContextChatMessage[],
  latest: readonly ContextChatMessage[],
): readonly ContextChatMessage[] {
  const messages = new Map<string, ContextChatMessage>();
  for (const message of [...older, ...latest]) {
    const previous = messages.get(message.id);
    if (
      message.channelId === channelId &&
      (!previous || message.changeVersion >= previous.changeVersion)
    )
      messages.set(message.id, message);
  }
  return [...messages.values()].sort((a, b) => b.sequence - a.sequence);
}

export const contextChatUnread = (
  messages: readonly ContextChatMessage[],
  readSequence: number,
  selfId: string,
) =>
  messages.filter(
    (message) =>
      !('unavailable' in message) &&
      message.authorActorId !== selfId &&
      message.sequence > readSequence,
  ).length;
