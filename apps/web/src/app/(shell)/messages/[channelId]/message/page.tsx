import { ConversationLive } from '../../../../../ui/messaging/conversation-live';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { systemId } from '@daisy/clock';
import { requireAccess } from '../../../../../lib/access';
import type { MessagingChannelPageProps } from '../../../../../features/messaging/channel-page';
import { readConversationResponse } from '../../../../../features/messaging/conversation';
import { MessageMutationForm } from '../../../../../ui/messaging/message-mutation-form';
import { messagePageContext } from '../message-page-context';
import { GET } from '../../../../api/messaging/channels/[channelId]/messages/route';
import { changeMessageAction } from '../actions';
export const metadata = { title: 'Your message' };
export default async function OwnMessagePage(props: MessagingChannelPageProps) {
  const identity = await requireAccess('/messages', props.searchParams);
  const { channelId, messageId, intent, incoming } =
    await messagePageContext(props);
  const query = new URLSearchParams();
  if (typeof intent.before === 'string') query.set('before', intent.before);
  const conversation = await readConversationResponse(
    await GET(
      new Request(
        `http://in-process.invalid/api/messaging/channels/${channelId}/messages?${query}`,
        { headers: incoming },
      ),
    ),
  );
  const message = conversation?.history.messages.find(
    (item) => item.id === messageId,
  );
  if (
    conversation === null ||
    message === undefined ||
    'unavailable' in message ||
    identity.state !== 'member' ||
    message.authorActorId !== identity.principal.actorId
  )
    notFound();
  const requestId = systemId.next();
  return (
    <main className="mx-auto flex w-full max-w-reading flex-col gap-6 p-6">
      <h1>Your message</h1>
      <p>Revise your message or remove it from the conversation.</p>
      <ConversationLive
        channelId={channelId}
        socketUrl={conversation.socketUrl}
        snapshotId={requestId}
      >
        <MessageMutationForm
          action={changeMessageAction.bind(null, channelId, messageId)}
          state={{ requestId, text: message.text }}
          removeRequestId={systemId.next()}
          maxUnits={conversation.bounds.messageUnits}
        />
      </ConversationLive>
      <Link href={`/messages/${channelId}`}>Back to conversation</Link>
    </main>
  );
}
