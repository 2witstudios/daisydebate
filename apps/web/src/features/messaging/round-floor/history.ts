import type { MessagingConversation } from '../conversation';

export type FloorMessage = MessagingConversation['messages'][number];

/** Latest revisions replace overlapping older pages; unrelated channels never enter the thread. */
export function mergeFloorMessages(
  channelId: string,
  older: readonly FloorMessage[],
  latest: readonly FloorMessage[],
): readonly FloorMessage[] {
  const messages = new Map<string, FloorMessage>();
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

export const floorUnread = (
  messages: readonly FloorMessage[],
  readSequence: number,
  selfId: string,
) =>
  messages.filter(
    (message) =>
      !('unavailable' in message) &&
      message.authorActorId !== selfId &&
      message.sequence > readSequence,
  ).length;
