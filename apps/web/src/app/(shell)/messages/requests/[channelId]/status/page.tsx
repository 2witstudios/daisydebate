import { ConversationPane } from '../../../../../../ui/messaging/conversation-pane';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { systemId } from '@daisy/clock';
import { idSchema, messagingDmResultSchema } from '@daisy/protocol';
import { requireAccess } from '../../../../../../lib/access';
import type { MessagingChannelPageProps } from '../../../../../../features/messaging/channel-page';
import { RequestDecision } from '../../../../../../ui/messaging/request-decision';
import { GET } from '../../../../../api/messaging/requests/[channelId]/status/route';
import { GET as PREVIEW } from '../../../../../api/messaging/requests/[channelId]/route';
import { decideDmAction } from '../actions';
export const metadata = { title: 'Sent request' };
export default async function SentRequestPage({
  params,
  searchParams,
}: MessagingChannelPageProps) {
  await requireAccess('/messages', searchParams);
  const id = idSchema.safeParse((await params).channelId);
  if (!id.success) notFound();
  const response = await GET(
    new Request(
      `http://in-process.invalid/api/messaging/requests/${id.data}/status`,
      { headers: new Headers(await headers()) },
    ),
  );
  const result = response.ok
    ? messagingDmResultSchema.safeParse(await response.json())
    : null;
  const pending =
    result?.success &&
    result.data.channelId === id.data &&
    result.data.state === 'pending';
  // A recipient reaching the sender's status page (the Message button on
  // someone who already asked them) is handed to the request itself, only
  // when their own request grant answers.
  if (!pending && (await recipientCanOpen(id.data)))
    redirect(`/messages/requests/${id.data}`);
  return (
    <ConversationPane title="Sent request">
      {pending ? (
        <>
          <p>Your message request is waiting for a response.</p>
          <RequestDecision
            mode="sender"
            action={decideDmAction.bind(null, id.data)}
            requestId={systemId.next()}
          />
        </>
      ) : (
        <p role="status">
          This request is unavailable or has already been decided. Return to
          messages for its current status.
        </p>
      )}
    </ConversationPane>
  );
}

async function recipientCanOpen(channelId: string) {
  const response = await PREVIEW(
    new Request(
      `http://in-process.invalid/api/messaging/requests/${channelId}`,
      {
        headers: new Headers(await headers()),
      },
    ),
  );
  return response.ok;
}
