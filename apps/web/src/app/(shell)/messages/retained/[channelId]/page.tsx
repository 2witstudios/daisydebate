import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { idSchema, messagingRetainedSchemas } from '@daisy/protocol';
import { requireAccess } from '../../../../../lib/access';
import type { MessagingChannelPageProps } from '../../../../../features/messaging/channel-page';
import { PageHeader } from '../../../../../ui/components/page-header/page-header';
import { RetainedDeleteForm } from '../../../../../ui/messaging/retained-delete-form';
import { GET } from '../../../../api/messaging/retained/[channelId]/route';
import { deleteRetainedAction } from './actions';

export const metadata = { title: 'Conversation with a deleted account' };

/**
 * DEC-126: what a survivor kept of a DM whose other member was erased:
 * their own messages, read-only, and a way to delete them.
 */
export default async function RetainedConversationPage({
  params,
  searchParams,
}: MessagingChannelPageProps) {
  const [{ channelId }] = await Promise.all([
    params,
    requireAccess('/messages', searchParams),
  ]);
  const id = idSchema.safeParse(channelId);
  if (!id.success) notFound();
  const url = `http://in-process.invalid/api/messaging/retained/${id.data}`;
  const response = await GET(
    new Request(url, { headers: new Headers(await headers()) }),
  );
  const conversation = response.ok
    ? messagingRetainedSchemas.conversation.safeParse(await response.json())
    : null;
  if (!conversation?.success) notFound();
  return (
    <main className="mx-auto flex w-full max-w-reading flex-col gap-6 p-6">
      <PageHeader
        title="Conversation with a deleted account"
        lede="The other person's account was deleted. Only your own messages remain, and only you can see them."
        actions={<Link href="/messages">Back to messages</Link>}
      />
      <ol aria-label="Your messages" className="flex flex-col gap-3">
        {conversation.data.messages.map((message) => (
          <li
            key={message.id}
            className="rounded-md border border-border bg-surface-raised p-3"
          >
            <p className="whitespace-pre-wrap">{message.text}</p>
            <time
              dateTime={message.createdAt}
              className="text-sm text-ink-muted"
            >
              {new Date(message.createdAt).toUTCString()}
            </time>
          </li>
        ))}
      </ol>
      <RetainedDeleteForm action={deleteRetainedAction.bind(null, id.data)} />
    </main>
  );
}
