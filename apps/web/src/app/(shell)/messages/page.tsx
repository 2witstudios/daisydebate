import { createAppError } from '@daisy/errors';
import { systemId } from '@daisy/clock';
import { InboxLive } from '../../../ui/messaging/conversation-live';
import { headers } from 'next/headers';
import Link from 'next/link';
import { requireAccess } from '../../../lib/access';
import type { SearchParams } from '../../../features/access/decision';
import { readMessagingInboxResponse } from '../../../features/messaging/inbox-response';
import { PageHeader } from '../../../ui/components/page-header/page-header';
import { GET } from '../../api/messaging/inbox/route';
export const metadata = { title: 'Messages' };
const labels = {
  conversation: 'Conversation',
  incoming_request: 'Message request',
  outgoing_request: 'Sent request',
  incoming_invitation: 'Group invitation',
} as const;
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
  const response = await GET(
    new Request(`http://in-process.invalid/api/messaging/inbox${query}`, {
      headers: new Headers(await headers()),
    }),
  );
  const inbox = await readMessagingInboxResponse(response);
  return (
    <main className="mx-auto flex w-full max-w-reading flex-col gap-6 p-6">
      <PageHeader
        title="Messages"
        actions={<Link href="/lobby">Back to lobby</Link>}
      />
      <nav aria-label="Start a conversation" className="flex gap-4">
        <Link href="/messages/new">Message someone</Link>
        <Link href="/messages/new?kind=group">Create private group</Link>
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
            <p className="text-ink-muted">
              No conversations or requests on this page.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {inbox.entries.map((entry) => (
                <li
                  key={entry.channelId}
                  className="rounded-lg border border-border bg-surface-raised p-4"
                >
                  <Link
                    href={
                      entry.kind === 'incoming_invitation'
                        ? `/messages/groups/invitations/${entry.channelId}`
                        : entry.kind === 'conversation'
                          ? `/messages/${entry.channelId}`
                          : entry.kind === 'incoming_request'
                            ? `/messages/requests/${entry.channelId}`
                            : `/messages/requests/${entry.channelId}/status`
                    }
                  >
                    {labels[entry.kind]}
                  </Link>
                </li>
              ))}
            </ul>
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
    </main>
  );
}
