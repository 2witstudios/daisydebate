import { createAppError } from '@daisy/errors';
import { systemClock, systemId } from '@daisy/clock';
import { InboxLive } from '../../../ui/messaging/conversation-live';
import { headers } from 'next/headers';
import Link from 'next/link';
import { requireAccess } from '../../../lib/access';
import { privateGroupsOffered } from '../../../lib/request-session';
import type { SearchParams } from '../../../features/access/decision';
import { readMessagingInboxResponse } from '../../../features/messaging/inbox-response';
import { PageHeader } from '../../../ui/components/page-header/page-header';
import { buttonClass } from '../../../ui/components/button/button-class';
import { InboxEmpty } from '../../../ui/messaging/inbox-empty';
import { InboxRow } from '../../../ui/messaging/inbox-row';
import { RetainedConversationList } from '../../../ui/messaging/retained-list';
import { GET } from '../../api/messaging/inbox/route';
import { GET as retainedList } from '../../api/messaging/retained/route';
import { messagingRetainedSchemas } from '@daisy/protocol';

/** The survivor's retained conversations (DEC-126), or none when unreadable. */
async function readRetainedConversations(response: Response) {
  if (!response.ok) return [];
  const parsed = messagingRetainedSchemas.list.safeParse(await response.json());
  return parsed.success ? parsed.data.conversations : [];
}
export const metadata = { title: 'Messages' };
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const identity = await requireAccess('/messages', searchParams);
  const actorId =
    identity.state === 'member' ? identity.principal.actorId : null;
  if (actorId === null) throw createAppError('AUTHORIZATION');
  const params = await searchParams;
  const query =
    typeof params.after === 'string'
      ? `?after=${encodeURIComponent(params.after)}`
      : '';
  const incoming = await headers();
  const [inbox, retained] = await Promise.all([
    GET(
      new Request(`http://in-process.invalid/api/messaging/inbox${query}`, {
        headers: new Headers(incoming),
      }),
    ).then(readMessagingInboxResponse),
    retainedList(
      new Request('http://in-process.invalid/api/messaging/retained', {
        headers: new Headers(incoming),
      }),
    ).then(readRetainedConversations),
  ]);
  const now = systemClock.now();
  return (
    <main className="mx-auto flex w-full max-w-reading flex-col gap-6 p-6">
      <PageHeader
        title="Messages"
        actions={
          <>
            <Link href="/messages/new" className={buttonClass('primary')}>
              New message
            </Link>
            <Link href="/lobby" className={buttonClass('ghost')}>
              Back to lobby
            </Link>
          </>
        }
      />
      <nav
        aria-label="Messaging tools"
        className="flex flex-wrap gap-x-6 gap-y-2 text-sm"
      >
        {privateGroupsOffered() ? (
          <Link href="/messages/new?kind=group" className="font-strong">
            Create private group
          </Link>
        ) : null}
        <Link href="/messages/contacts" className="font-strong">
          Contact safety
        </Link>
      </nav>
      {inbox === null ? (
        <p role="status">Messages are unavailable. Refresh to try again.</p>
      ) : (
        <InboxLive
          actorId={actorId}
          socketUrl={inbox.socketUrl}
          snapshotId={systemId.next()}
        >
          {inbox.entries.length === 0 ? (
            inbox.nextAfter === null && params.after === undefined ? (
              <InboxEmpty />
            ) : (
              <p className="text-ink-muted">
                No conversations or requests on this page.
              </p>
            )
          ) : (
            <section
              aria-labelledby="conversations-heading"
              className="flex flex-col gap-3"
            >
              <h2
                id="conversations-heading"
                className="text-sm font-semibold text-ink-muted"
              >
                Conversations
              </h2>
              <ul aria-label="Conversations" className="flex flex-col gap-3">
                {inbox.entries.map((entry) => (
                  <InboxRow key={entry.channelId} entry={entry} now={now} />
                ))}
              </ul>
            </section>
          )}
          {inbox.nextAfter ? (
            <Link
              href={`/messages?after=${encodeURIComponent(inbox.nextAfter)}`}
            >
              Next page
            </Link>
          ) : null}
        </InboxLive>
      )}
      <RetainedConversationList conversations={retained} />
    </main>
  );
}
