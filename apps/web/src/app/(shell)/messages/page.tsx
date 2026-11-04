import { systemClock } from '@daisy/clock';
import { headers } from 'next/headers';
import Link from 'next/link';
import { requireAccess } from '../../../lib/access';
import type { SearchParams } from '../../../features/access/decision';
import { inboxPageHref } from '../../../features/messaging/inbox-view';
import { readMessagingInboxResponse } from '../../../features/messaging/inbox-response';
import { ConversationPane } from '../../../ui/messaging/conversation-pane';
import { InboxPrompt } from '../../../ui/messaging/inbox-prompt';
import { InboxRow } from '../../../ui/messaging/inbox-row';
import { GET } from '../../api/messaging/inbox/route';

export const metadata = { title: 'Messages' };

/** Search or a later page for a reader with no JavaScript: the list's own read. */
async function InboxResults({
  q,
  after,
}: {
  readonly q: string | undefined;
  readonly after: string | undefined;
}) {
  const params = new URLSearchParams();
  if (q !== undefined) params.set('q', q);
  if (after !== undefined) params.set('after', after);
  const inbox = await readMessagingInboxResponse(
    await GET(
      new Request(`http://in-process.invalid/api/messaging/inbox?${params}`, {
        headers: new Headers(await headers()),
      }),
    ),
  ).catch(() => null);
  const now = systemClock.now();
  const title = q === undefined ? 'More conversations' : 'Search results';
  const next = inbox?.nextAfter
    ? inboxPageHref(inbox.nextAfter, q ?? null)
    : null;
  return (
    <ConversationPane title={title}>
      {inbox === null ? (
        <p role="status" className="text-ink-muted">
          That search could not be read. Try again.
        </p>
      ) : inbox.entries.length === 0 ? (
        <p className="text-ink-muted">
          {q === undefined
            ? 'No conversations on this page.'
            : 'No conversations match.'}
        </p>
      ) : (
        <ul aria-label={title} className="flex list-none flex-col gap-1">
          {inbox.entries.map((entry) => (
            <InboxRow key={entry.channelId} entry={entry} now={now} />
          ))}
        </ul>
      )}
      {next ? <Link href={next}>Next page</Link> : null}
    </ConversationPane>
  );
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/messages', searchParams);
  const { q, after } = await searchParams;
  const search = typeof q === 'string' && q.trim() !== '' ? q : undefined;
  const page = typeof after === 'string' ? after : undefined;
  return search !== undefined || page !== undefined ? (
    <InboxResults q={search} after={page} />
  ) : (
    <InboxPrompt />
  );
}
