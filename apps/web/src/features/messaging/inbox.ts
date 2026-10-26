import { isAppError } from '@daisy/errors';
import type { MessagingInboxSummary } from '@daisy/db/messaging';
import { messagingInboxPreviewMax } from '@daisy/protocol';
type SummarizedKind =
  | 'conversation'
  | 'group_conversation'
  | 'incoming_request'
  | 'outgoing_request';
export type MessagingInboxEntry =
  | {
      readonly channelId: string;
      readonly kind: SummarizedKind;
      readonly title: string | null;
      readonly preview: {
        readonly text: string;
        readonly fromSelf: boolean;
      } | null;
      readonly activityAt: string;
      readonly unread: boolean;
    }
  | { readonly channelId: string; readonly kind: 'incoming_invitation' };

/** One line of at most the protocol bound, cut on code points with an ellipsis. */
export function messagingInboxExcerpt(text: string): string | null {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line === '') return null;
  if (line.length <= messagingInboxPreviewMax) return line;
  let excerpt = '';
  for (const point of line) {
    if (excerpt.length + point.length > messagingInboxPreviewMax - 1) break;
    excerpt += point;
  }
  return `${excerpt.trimEnd()}…`;
}

export function summarizeMessagingInboxEntry(
  channelId: string,
  kind: SummarizedKind,
  summary: MessagingInboxSummary,
): MessagingInboxEntry {
  const source = summary.lastMessage ?? summary.introduction;
  const text = source?.text ? messagingInboxExcerpt(source.text) : null;
  return {
    channelId,
    kind,
    title: summary.title,
    preview:
      source && text !== null ? { text, fromSelf: source.fromSelf } : null,
    activityAt:
      summary.lastMessage?.createdAt ??
      summary.introduction?.requestedAt ??
      summary.createdAt,
    unread: summary.unread,
  };
}

/** Invitations await a decision, so they lead; then newest activity first. */
const byAttention = (a: MessagingInboxEntry, b: MessagingInboxEntry) =>
  a.kind === 'incoming_invitation' || b.kind === 'incoming_invitation'
    ? Number(b.kind === 'incoming_invitation') -
      Number(a.kind === 'incoming_invitation')
    : b.activityAt.localeCompare(a.activityAt);
export async function readMessagingInbox(
  input: { readonly limit: number; readonly after?: string },
  port: {
    readonly candidates: (input: {
      readonly limit: number;
      readonly after?: string;
    }) => Promise<readonly string[]>;
    readonly inspect: (channelId: string) => Promise<MessagingInboxEntry>;
  },
) {
  const candidates = await port.candidates(input);
  const entries: MessagingInboxEntry[] = [];
  for (const channelId of candidates) {
    try {
      entries.push(await port.inspect(channelId));
    } catch (error) {
      if (
        !isAppError(error) ||
        !['AUTHORIZATION', 'NOT_FOUND', 'CONFLICT'].includes(error.code)
      )
        throw error;
    }
  }
  return {
    entries: entries.sort(byAttention),
    nextAfter:
      candidates.length === input.limit ? (candidates.at(-1) ?? null) : null,
  };
}

/** A denied history grant may still have a distinct minimal invitation grant; outages never do. */
export async function inspectMessagingInboxAssociation(
  channelId: string,
  port: {
    readonly channel: () => Promise<MessagingInboxEntry>;
    readonly invitation: () => Promise<void>;
  },
): Promise<MessagingInboxEntry> {
  try {
    return await port.channel();
  } catch (error) {
    if (
      !isAppError(error) ||
      !['AUTHORIZATION', 'NOT_FOUND'].includes(error.code)
    )
      throw error;
  }
  await port.invitation();
  return { channelId, kind: 'incoming_invitation' };
}
