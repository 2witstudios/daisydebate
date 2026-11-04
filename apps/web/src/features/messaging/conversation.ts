import { z } from 'zod';
import { realtimePublicUrlSchema } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import {
  createMessagingCoreSchemas,
  messagingTypingSchemas,
} from '@daisy/protocol';

export type MessagingConversation = z.infer<
  ReturnType<typeof createMessagingCoreSchemas>['historyResult']
>;

/** The browser/server-render adapter validates the authorized wire response. */
export async function readConversationResponse(response: Response) {
  if (!response.ok) return null;
  const positive = z.coerce.number().int().positive().safe();
  const parsedBounds = z
    .object({ messageUnits: positive, pageItems: positive })
    .safeParse({
      messageUnits: response.headers.get('x-messaging-message-units'),
      pageItems: response.headers.get('x-messaging-page-items'),
    });
  if (!parsedBounds.success) throw createAppError('INFRASTRUCTURE');
  const bounds = parsedBounds.data;
  const viewed = createMessagingCoreSchemas(
    bounds,
  ).viewedHistoryResult.safeParse(await response.json());
  if (!viewed.success) throw createAppError('INFRASTRUCTURE');
  // The reader's own state stays apart from the page every member shares.
  const { viewer, ...history } = viewed.data;
  const endpoint = response.headers.get('x-realtime-socket-url');
  const socketUrl =
    endpoint === null ? null : realtimePublicUrlSchema.parse(endpoint);
  const configured = response.headers.get('x-messaging-typing-refetch-ms');
  const recovery =
    configured === null
      ? null
      : messagingTypingSchemas.result.shape.refreshAfterMs.safeParse(
          Number(configured),
          { jitless: true },
        );
  if (recovery !== null && !recovery.success)
    throw createAppError('INFRASTRUCTURE');
  return {
    history,
    viewer,
    bounds,
    socketUrl,
    typingRefetchMs: recovery?.data ?? null,
  };
}

/**
 * The newest sequence a reader has now seen: only the live first page counts,
 * never a search result or an older page, so reading history never skips
 * unread messages.
 */
export function readThroughSequence(
  history: MessagingConversation,
  view: { readonly searching: boolean; readonly paging: boolean },
): number | null {
  if (view.searching || view.paging || history.messages.length === 0)
    return null;
  return Math.max(...history.messages.map((message) => message.sequence));
}

type ChannelEntry = ReturnType<
  ReturnType<
    typeof import('@daisy/protocol').createMessagingInboxSchemas
  >['entry']['parse']
>['entry'];

/**
 * ISSUE-605: what a conversation page calls itself and the other author: a
 * DM's counterpart by public @username, a group by its title. Group
 * authors stay "Member" until groups return (ISSUE-643).
 */
export function conversationNames(entry: ChannelEntry | null): {
  readonly title: string;
  readonly otherAuthor: string;
  /** The counterpart's public username: a DM's only, and never an erased one. */
  readonly username: string | null;
  readonly isGroup: boolean;
} {
  if (entry === null || entry.kind === 'incoming_invitation')
    return {
      title: 'Conversation',
      otherAuthor: 'Member',
      username: null,
      isGroup: false,
    };
  if (entry.kind === 'group_conversation')
    return {
      title: entry.title ?? 'Untitled group',
      otherAuthor: 'Member',
      username: null,
      isGroup: true,
    };
  const name = entry.title === null ? 'Deleted account' : `@${entry.title}`;
  return {
    title: name,
    otherAuthor: name,
    username: entry.title,
    isGroup: false,
  };
}
