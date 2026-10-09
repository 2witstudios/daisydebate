import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { systemId } from '@daisy/clock';
import { idSchema } from '@daisy/protocol';
import { requireAccess } from '../../../../lib/access';
import type { SearchParams } from '../../../../features/access/decision';
import { readConversationResponse } from '../../../../features/messaging/conversation';
import { PageHeader } from '../../../../ui/components/page-header/page-header';
import { MessageComposer } from '../../../../ui/messaging/message-composer';
import { GET } from '../../../api/messaging/channels/[channelId]/messages/route';
import { sendMessageAction } from './actions';
export const metadata = { title: 'Messages' };
export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const identity = await requireAccess('/messages', searchParams);
  const id = idSchema.safeParse((await params).channelId);
  if (!id.success) notFound();
  const query = await searchParams;
  const response = await GET(
    new Request(
      `http://in-process.invalid/api/messaging/channels/${id.data}/messages${typeof query.before === 'string' ? `?before=${encodeURIComponent(query.before)}` : ''}`,
      { headers: new Headers(await headers()) },
    ),
  );
  const conversation = await readConversationResponse(response);
  const actorId =
    identity.state === 'member' ? identity.principal.actorId : null;
  return (
    <main className="max-w-3xl mx-auto flex w-full flex-col gap-6 p-6">
      <PageHeader
        title="Conversation"
        lede="Private messages"
        actions={<Link href="/lobby">Back to lobby</Link>}
      />
      {conversation === null ? (
        <p
          role="status"
          className="rounded-lg border border-border p-5 text-ink-muted"
        >
          This conversation is unavailable. Refresh to try again.
        </p>
      ) : (
        <>
          {conversation.history.messages.length === 0 ? (
            <p className="text-ink-muted">No messages yet.</p>
          ) : (
            <ol aria-label="Message history" className="flex flex-col gap-3">
              {[...conversation.history.messages].reverse().map((message) => (
                <li
                  key={message.id}
                  className="rounded-lg border border-border bg-surface-raised p-4"
                >
                  {'unavailable' in message ? (
                    <p className="text-sm text-ink-muted">
                      Message unavailable
                    </p>
                  ) : (
                    <>
                      <p className="mb-2 text-xs text-ink-muted">
                        {message.authorActorId === actorId
                          ? 'You'
                          : 'Participant'}{' '}
                        ·{' '}
                        <time dateTime={message.createdAt}>
                          {message.createdAt
                            .replace('T', ' ')
                            .replace('.000Z', ' UTC')}
                        </time>
                        {message.editedAt ? ' · edited' : ''}
                      </p>
                      <p className="break-words whitespace-pre-wrap text-ink">
                        {message.text}
                      </p>
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
          {conversation.history.nextBefore ? (
            <Link
              href={`/messages/${id.data}?before=${conversation.history.nextBefore.sequence}`}
            >
              Earlier messages
            </Link>
          ) : null}
          <MessageComposer
            key={typeof query.sent === 'string' ? query.sent : id.data}
            action={sendMessageAction.bind(null, id.data)}
            requestId={systemId.next()}
            maxUnits={conversation.bounds.messageUnits}
          />
        </>
      )}
    </main>
  );
}
