import type { MessagingConversation } from './conversation';

type HistoryMessage = MessagingConversation['messages'][number];
type LiveMessage = Extract<HistoryMessage, { readonly text: string }>;

export type MessageRow =
  | { readonly kind: 'day'; readonly key: string; readonly label: string }
  | { readonly kind: 'unread'; readonly key: string }
  | {
      readonly kind: 'message';
      readonly key: string;
      readonly message: LiveMessage;
      readonly mine: boolean;
      readonly author: string;
      /** Whether the row opens a run and so shows who wrote it. */
      readonly leads: boolean;
      readonly time: string;
    }
  | {
      readonly kind: 'unavailable';
      readonly key: string;
      readonly message: HistoryMessage;
    };

/** Messages this close from one author read as one run. */
export const messageRunMs = 5 * 60_000;

const dayKey = (at: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));

const dayLabel = (at: string, now: string, timeZone: string) => {
  const key = dayKey(at, timeZone);
  if (key === dayKey(now, timeZone)) return 'Today';
  const yesterday = new Date(Date.parse(now) - 24 * 60 * 60_000).toISOString();
  if (key === dayKey(yesterday, timeZone)) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(at));
};

/** A time of day in the reader's zone; the server's render says UTC. */
export const messageTime = (at: string, timeZone: string): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone === 'UTC' ? { timeZoneName: 'short' } : {}),
  }).format(new Date(at));

/**
 * Pure: history (newest first, as it is read) into what the page draws, oldest
 * first: day separators, runs by one author, and the divider above the first
 * unread message. A removed message keeps its place and carries no day, since
 * it discloses no time, and it ends a run.
 */
export function messageRows({
  messages,
  actorId,
  otherAuthor,
  firstUnreadSequence,
  now,
  timeZone,
}: {
  readonly messages: readonly HistoryMessage[];
  readonly actorId: string | null;
  readonly otherAuthor: string;
  readonly firstUnreadSequence: number | null;
  readonly now: string;
  readonly timeZone: string;
}): readonly MessageRow[] {
  const rows: MessageRow[] = [];
  let previous: LiveMessage | null = null;
  let day: string | null = null;
  for (const message of [...messages].reverse()) {
    if (message.sequence === firstUnreadSequence) {
      rows.push({ kind: 'unread', key: 'first-unread' });
      previous = null;
    }
    if ('unavailable' in message) {
      rows.push({ kind: 'unavailable', key: message.id, message });
      previous = null;
      continue;
    }
    const thisDay = dayKey(message.createdAt, timeZone);
    if (thisDay !== day) {
      rows.push({
        kind: 'day',
        key: `day-${thisDay}`,
        label: dayLabel(message.createdAt, now, timeZone),
      });
      day = thisDay;
      previous = null;
    }
    const continues: boolean =
      previous !== null &&
      previous.authorActorId === message.authorActorId &&
      Date.parse(message.createdAt) - Date.parse(previous.createdAt) <
        messageRunMs;
    const mine = message.authorActorId === actorId;
    rows.push({
      kind: 'message',
      key: message.id,
      message,
      mine,
      author: mine ? 'You' : otherAuthor,
      leads: !continues,
      time: messageTime(message.createdAt, timeZone),
    });
    previous = message;
  }
  return rows;
}

/**
 * Where to read from when the first unread message is older than what is drawn:
 * a page that begins at it. Null when it is on screen or there is none.
 */
export function earlierUnreadSequence(
  messages: readonly HistoryMessage[],
  firstUnreadSequence: number | null,
): number | null {
  const oldest = messages.at(-1)?.sequence;
  return firstUnreadSequence !== null &&
    oldest !== undefined &&
    firstUnreadSequence < oldest
    ? firstUnreadSequence
    : null;
}
