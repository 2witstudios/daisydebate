/**
 * The conversation list as a reader holds it: what the inbox read answered,
 * pure and free of server dependencies, so the browser and the server order
 * and merge entries the same way.
 */
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

export type MessagingInboxPageAnswer = {
  readonly entries: readonly MessagingInboxEntry[];
  readonly nextAfter: string | null;
};

/** Invitations await a decision, so they lead; then newest activity first. */
export const byAttention = (
  a: MessagingInboxEntry,
  b: MessagingInboxEntry,
): number => {
  if (a.kind === 'incoming_invitation' || b.kind === 'incoming_invitation') {
    const lead =
      Number(b.kind === 'incoming_invitation') -
      Number(a.kind === 'incoming_invitation');
    return lead !== 0 ? lead : a.channelId.localeCompare(b.channelId);
  }
  return (
    b.activityAt.localeCompare(a.activityAt) ||
    a.channelId.localeCompare(b.channelId)
  );
};

/** The next page after what is loaded; a conversation that moved appears once. */
export function appendPage(
  loaded: MessagingInboxPageAnswer,
  page: MessagingInboxPageAnswer,
): MessagingInboxPageAnswer {
  const fresh = new Set(page.entries.map((entry) => entry.channelId));
  return {
    entries: [
      ...loaded.entries.filter((entry) => !fresh.has(entry.channelId)),
      ...page.entries,
    ].sort(byAttention),
    nextAfter: page.nextAfter,
  };
}

/** The native continuation and refused-fetch fallback ask the same inbox question. */
export function inboxPageHref(after: string, q: string | null): string {
  const params = new URLSearchParams({ after });
  if (q !== null) params.set('q', q);
  return `/messages?${params}`;
}
