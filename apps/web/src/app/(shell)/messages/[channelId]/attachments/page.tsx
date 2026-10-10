import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { systemId } from '@daisy/clock';
import { idSchema } from '@daisy/protocol';
import { requireAccess } from '../../../../../lib/access';
import type { MessagingChannelPageProps } from '../../../../../features/messaging/channel-page';
import { messagingFileResponseSchemas } from '../../../../../features/messaging/files/response';
import { AttachmentForm } from '../../../../../ui/messaging/attachment-form';
import { GET } from '../../../../api/messaging/channels/[channelId]/files/route';
export const metadata = { title: 'Message attachments' };
export default async function MessageAttachmentsPage({
  params,
  searchParams,
}: MessagingChannelPageProps) {
  await requireAccess('/messages', searchParams);
  const intent = await searchParams;
  const channel = idSchema.safeParse((await params).channelId),
    message = idSchema.safeParse(intent.messageId);
  if (!channel.success || !message.success) notFound();
  const response = await GET(
    new Request(
      `http://in-process.invalid/api/messaging/channels/${channel.data}/files?messageId=${message.data}`,
      { headers: new Headers(await headers()) },
    ),
  );
  if (!response.ok)
    return (
      <main>
        <h1>Attachments unavailable</h1>
        <Link href={`/messages/${channel.data}`}>Back to conversation</Link>
      </main>
    );
  const parsed = messagingFileResponseSchemas(response).listResult.safeParse(
    await response.json(),
  );
  if (!parsed.success)
    return (
      <main>
        <h1>Attachments unavailable</h1>
      </main>
    );
  return (
    <main className="mx-auto flex w-full max-w-reading flex-col gap-6 p-6">
      <h1>Message attachments</h1>
      <ul>
        {parsed.data.files.map((file) => (
          <li key={file.fileId}>
            <a
              href={`/api/messaging/channels/${channel.data}/files/${file.fileId}?generation=${file.generation}`}
            >
              {file.filename}
            </a>{' '}
            · {file.bytes} bytes
          </li>
        ))}
      </ul>
      {intent.attach === '1' ? (
        <AttachmentForm
          channelId={channel.data}
          messageId={message.data}
          state={{ requestId: systemId.next(), filename: '' }}
        />
      ) : null}
      <Link href={`/messages/${channel.data}`}>Back to conversation</Link>
    </main>
  );
}
