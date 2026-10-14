import { messagePageContext } from '../message-page-context';
import Link from 'next/link';
import { systemId } from '@daisy/clock';
import { requireAccess } from '../../../../../lib/access';
import type { MessagingChannelPageProps } from '../../../../../features/messaging/channel-page';
import { readReactionResponse } from '../../../../../features/messaging/reaction-response';
import { ReactionsLive } from '../../../../../ui/messaging/conversation-live';
import { readConversationResponse } from '../../../../../features/messaging/conversation';
import { GET as MESSAGES } from '../../../../api/messaging/channels/[channelId]/messages/route';
import { GET } from '../../../../api/messaging/channels/[channelId]/reactions/route';
import { changeReactionAction } from './actions';
export const metadata = { title: 'Message reactions' };
export default async function MessageReactionsPage({
  params,
  searchParams,
}: MessagingChannelPageProps) {
  await requireAccess('/messages', searchParams);
  const { channelId, messageId, incoming, intent } = await messagePageContext({
    params,
    searchParams,
  });
  const position = Number(intent.before);
  const before =
    typeof intent.before === 'string' &&
    Number.isSafeInteger(position) &&
    position > 1
      ? position
      : null;
  const conversation = await readConversationResponse(
    await MESSAGES(
      new Request(
        `http://in-process.invalid/api/messaging/channels/${channelId}/messages${before === null ? '' : `?before=${before}`}`,
        { headers: incoming },
      ),
    ),
  );
  const response = await GET(
    new Request(
      `http://in-process.invalid/api/messaging/channels/${channelId}/reactions?messageId=${messageId}`,
      { headers: incoming },
    ),
    { params: Promise.resolve({ channelId: channelId }) },
  );
  const current = await readReactionResponse(response, channelId, messageId);
  return (
    <main className="mx-auto flex w-full max-w-reading flex-col gap-6 p-6">
      <h1>Message reactions</h1>
      {current === null ? (
        <p role="status">Reactions are unavailable. Refresh to try again.</p>
      ) : (
        <ReactionsLive
          channelId={channelId}
          messageId={messageId}
          bounds={conversation?.bounds ?? null}
          before={before}
          initial={current.result.reactions}
          action={changeReactionAction.bind(null, channelId, messageId)}
          forms={[
            ...new Set([
              ...current.policy.choices,
              ...current.result.reactions
                .filter((item) => item.own)
                .map((item) => item.reaction),
            ]),
          ].map((reaction) => ({ reaction, requestId: systemId.next() }))}
        />
      )}
      <Link href={`/messages/${channelId}`}>Back to conversation</Link>
    </main>
  );
}
