import type { Channel } from './workspace';

export type ChatMessage = {
  readonly id: string;
  readonly channelId: string;
  readonly author: {
    readonly id: string;
    readonly name: string;
    readonly role: 'judge' | 'debater' | 'member' | 'system';
  };
  readonly text: string;
  readonly sentAt: string;
};

type ReadMarkers = Readonly<Record<string, string>>;

/** Messages from others in a channel sent after readAt (all of them when null). */
export function unreadCount(
  messages: readonly ChatMessage[],
  channelId: string,
  readAt: string | null,
  selfId: string,
): number {
  const since = readAt === null ? Number.NEGATIVE_INFINITY : Date.parse(readAt);
  return messages.filter(
    (m) =>
      m.channelId === channelId &&
      m.author.id !== selfId &&
      Date.parse(m.sentAt) > since,
  ).length;
}

export function unreadByChannel(
  messages: readonly ChatMessage[],
  channels: readonly Channel[],
  readMarkers: ReadMarkers,
  selfId: string,
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    channels.map((channel) => [
      channel.id,
      unreadCount(
        messages,
        channel.id,
        Object.hasOwn(readMarkers, channel.id)
          ? (readMarkers[channel.id] ?? null)
          : null,
        selfId,
      ),
    ]),
  );
}

export function totalUnread(counts: Readonly<Record<string, number>>): number {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

export function markRead(
  readMarkers: ReadMarkers,
  channelId: string,
  now: string,
): ReadMarkers {
  return { ...readMarkers, [channelId]: now };
}

/** Appends a trimmed message; empty, over-long or duplicate messages are rejected. */
export function appendMessage(
  messages: readonly ChatMessage[],
  message: ChatMessage,
  maxLength: number,
): readonly ChatMessage[] {
  const text = message.text.trim();
  if (text === '' || text.length > maxLength) return messages;
  if (messages.some((m) => m.id === message.id)) return messages;
  return [...messages, { ...message, text }];
}
