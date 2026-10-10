import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { systemId } from '@daisy/clock';
import { idSchema } from '@daisy/protocol';
import { requireAccess } from '../../../../lib/access';
import type { SearchParams } from '../../../../features/access/decision';
import { readConversationResponse } from '../../../../features/messaging/conversation';
import { Button } from '../../../../ui/components/button/button';
import { PageHeader } from '../../../../ui/components/page-header/page-header';
import { ConversationLive } from '../../../../ui/messaging/conversation-live';
import { MessageHistory } from '../../../../ui/messaging/message-history';
import { MessageComposer } from '../../../../ui/messaging/message-composer';
import { GET } from '../../../api/messaging/channels/[channelId]/messages/route';
import { GET as SEARCH } from '../../../api/messaging/channels/[channelId]/messages/search/route';
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
  const { searchQuery, conversation } = await readPageConversation(
    id.data,
    query,
  );
  const actorId =
    identity.state === 'member' ? identity.principal.actorId : null;
  return (
    <main className="mx-auto flex w-full max-w-reading flex-col gap-6 p-6">
      <PageHeader
        title="Conversation"
        lede="Private messages"
        actions={<Link href="/lobby">Back to lobby</Link>}
      />
      <Link href={`/messages/${id.data}/preferences`}>
        Conversation preferences
      </Link>
      {conversation === null ? (
        <p
          role="status"
          className="rounded-lg border border-border p-5 text-ink-muted"
        >
          This conversation is unavailable. Refresh to try again.
        </p>
      ) : (
        <>
          <ConversationSearch
            channelId={id.data}
            maxUnits={conversation.bounds.messageUnits}
            searchQuery={searchQuery ?? null}
          />
          <ConversationLive
            channelId={id.data}
            socketUrl={conversation.socketUrl}
            snapshotId={systemId.next()}
          >
            <MessageHistory
              history={conversation.history}
              actorId={actorId}
              {...(searchQuery === undefined ? {} : { searchQuery })}
            />
          </ConversationLive>
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

async function readPageConversation(channelId: string, query: SearchParams) {
  const searchQuery = typeof query.query === 'string' ? query.query : undefined;
  const input = new URLSearchParams();
  if (typeof query.before === 'string') input.set('before', query.before);
  if (searchQuery !== undefined) input.set('query', searchQuery);
  const response = await (searchQuery === undefined ? GET : SEARCH)(
    new Request(
      `http://in-process.invalid/api/messaging/channels/${channelId}/messages${searchQuery === undefined ? '' : '/search'}?${input}`,
      { headers: new Headers(await headers()) },
    ),
  );
  return {
    searchQuery,
    conversation: await readConversationResponse(response),
  };
}
function ConversationSearch({
  channelId,
  maxUnits,
  searchQuery,
}: {
  readonly channelId: string;
  readonly maxUnits: number;
  readonly searchQuery: string | null;
}) {
  return (
    <form
      action={`/messages/${channelId}`}
      method="get"
      className="flex flex-wrap items-end gap-3"
    >
      <label className="flex flex-1 flex-col gap-2 text-sm font-semibold">
        Search messages
        <input
          name="query"
          type="search"
          defaultValue={searchQuery ?? ''}
          maxLength={maxUnits}
          required
          className="rounded-md border border-border-strong bg-surface px-3 py-2 text-ink"
        />
      </label>
      <Button
        type="submit"
        className="rounded-md border border-border px-4 py-2"
      >
        Search
      </Button>
      {searchQuery === null ? null : (
        <Link href={`/messages/${channelId}`}>Clear search</Link>
      )}
    </form>
  );
}
