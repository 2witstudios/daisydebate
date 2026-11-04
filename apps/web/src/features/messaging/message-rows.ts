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
const messageRunMs = 5 * 60_000;

const dayKey = (at: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));

const dayLabel = (at: string, now: string, timeZone: string) => {
  const key = dayKey(at, timeZone);
  const today = dayKey(now, timeZone);
  if (key === today) return 'Today';
  // Calendar dates remain a day apart even when a local day is 23 or 25 hours.
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (key === yesterday) return 'Yesterday';
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
    if (message.sequence === firstUnreadSequence) {
      rows.push({ kind: 'unread', key: 'first-unread' });
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
 * The reader's own place in a conversation, kept from when they opened it. Marking
 * it read moves the server's position, never this one.
 */
export type UnreadBoundary = {
  /** Where they had read to, as of opening. */
  readonly readSequence: number;
  /** The first unread message known so far, which may be older than the window. */
  readonly firstUnreadSequence: number | null;
};

const eligibleUnread = (
  messages: readonly HistoryMessage[],
  actorId: string | null,
  readSequence: number,
): number | null => {
  const eligible = messages.flatMap((message) =>
    !('unavailable' in message) &&
    message.authorActorId !== actorId &&
    message.sequence > readSequence
      ? [message.sequence]
      : [],
  );
  return eligible.length > 0 ? Math.min(...eligible) : null;
};

/**
 * Pure: the first unread message as these messages stand, including one that
 * arrived after opening. Once known it holds, so a window that slides past it
 * still knows there is something older to read.
 */
export const knownFirstUnread = (
  boundary: UnreadBoundary,
  messages: readonly HistoryMessage[],
  actorId: string | null,
): number | null =>
  boundary.firstUnreadSequence ??
  eligibleUnread(messages, actorId, boundary.readSequence);

/**
 * Pure: where the divider goes, or where to jump for it. The divider sits at the
 * actual first unread message, so when that is older than what is drawn there is
 * no divider, only the jump. A first unread since removed gives way to the next.
 */
export function unreadPlacement(
  boundary: UnreadBoundary,
  messages: readonly HistoryMessage[],
  actorId: string | null,
): {
  readonly dividerSequence: number | null;
  readonly jumpToSequence: number | null;
} {
  const known = knownFirstUnread(boundary, messages, actorId);
  const oldest = messages.at(-1)?.sequence;
  if (known === null || oldest === undefined)
    return { dividerSequence: null, jumpToSequence: null };
  if (known < oldest) return { dividerSequence: null, jumpToSequence: known };
  return {
    dividerSequence: eligibleUnread(messages, actorId, known - 1),
    jumpToSequence: null,
  };
}
