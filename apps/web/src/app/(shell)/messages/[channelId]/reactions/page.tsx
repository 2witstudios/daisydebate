import { ConversationLive } from '../../../../../ui/messaging/conversation-live';
import { messagePageContext } from '../message-page-context';
import Link from 'next/link';
import { systemId } from '@daisy/clock';
import { requireAccess } from '../../../../../lib/access';
import type { MessagingChannelPageProps } from '../../../../../features/messaging/channel-page';
import { readReactionResponse } from '../../../../../features/messaging/reaction-response';
import { ReactionForm } from '../../../../../ui/messaging/reaction-form';
import { GET } from '../../../../api/messaging/channels/[channelId]/reactions/route';
import { changeReactionAction } from './actions';
export const metadata = { title: 'Message reactions' };
export default async function MessageReactionsPage({
  params,
  searchParams,
}: MessagingChannelPageProps) {
  await requireAccess('/messages', searchParams);
  const { channelId, messageId, incoming } = await messagePageContext({
    params,
    searchParams,
  });
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
        <ConversationLive
          channelId={channelId}
          socketUrl={current.socketUrl}
          snapshotId={systemId.next()}
        >
          <ul aria-label="Current reactions">
            {current.result.reactions.map((item) => (
              <li key={item.reaction}>
                {item.reaction} · {item.count}
                {item.own ? ' · You reacted' : ''}
              </li>
            ))}
          </ul>
          {[
            ...new Set([
              ...current.policy.choices,
              ...current.result.reactions
                .filter((item) => item.own)
                .map((item) => item.reaction),
            ]),
          ].map((reaction) => (
            <ReactionForm
              key={reaction}
              action={changeReactionAction.bind(null, channelId, messageId)}
              requestId={systemId.next()}
              reaction={reaction}
              active={
                !current.result.reactions.some(
                  (item) => item.reaction === reaction && item.own,
                )
              }
            />
          ))}
        </ConversationLive>
      )}
      <Link href={`/messages/${channelId}`}>Back to conversation</Link>
    </main>
  );
}
