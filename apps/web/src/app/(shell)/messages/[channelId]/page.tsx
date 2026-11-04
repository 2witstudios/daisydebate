import { headers } from 'next/headers';
import {
  ConversationNavigation,
  ConversationLink as Link,
  ConversationSearchForm,
} from '../../../../ui/messaging/conversation-navigation';
import { notFound } from 'next/navigation';
import { systemClock, systemId } from '@daisy/clock';
import {
  channelMessagesWindow,
  createMessagingInboxSchemas,
  idSchema,
  messagingBetaLimits,
} from '@daisy/protocol';
import { requireAccess } from '../../../../lib/access';
import { messagingFilesAvailable } from '../../../../lib/request-session';
import type { SearchParams } from '../../../../features/access/decision';
import {
  readConversationResponse,
  readThroughSequence,
  conversationNames,
} from '../../../../features/messaging/conversation';
import { markReadUnavailableNotice } from '../../../../features/messaging/mark-read';
import { Button } from '../../../../ui/components/button/button';
import { Icon } from '../../../../ui/components/icon/icon';
import { ConversationOptions } from '../../../../ui/messaging/conversation-options';
import { ConversationPane } from '../../../../ui/messaging/conversation-pane';
import {
  ConversationAvatar,
  ConversationStatus,
} from '../../../../ui/messaging/conversation-presence';
import { ConversationLive } from '../../../../ui/messaging/conversation-live';
import { MessageHistory } from '../../../../ui/messaging/message-history';
import { MessageComposer } from '../../../../ui/messaging/message-composer';
import { GET } from '../../../api/messaging/channels/[channelId]/messages/route';
import { GET as SEARCH } from '../../../api/messaging/channels/[channelId]/messages/search/route';
import { GET as ENTRY } from '../../../api/messaging/channels/[channelId]/entry/route';
import { markReadAction, sendMessageAction } from './actions';
import { reactToMessageAction } from './reactions/actions';
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
  const requestId = systemId.next();
  const [{ searchQuery, conversation }, entry] = await Promise.all([
    readPageConversation(id.data, query),
    readChannelEntry(id.data),
  ]);
  const actorId =
    identity.state === 'member' ? identity.principal.actorId : null;
  const names = conversationNames(entry);
  const readThrough =
    conversation === null
      ? null
      : readThroughSequence(conversation.history, {
          searching: searchQuery !== undefined,
          paging: typeof query.before === 'string',
        });
  const now = systemClock.now();
  const filesAvailable = messagingFilesAvailable();
  const paging = typeof query.before === 'string';
  return (
    <ConversationNavigation key={id.data} requestId={requestId}>
      <ConversationPane
        bare
        title={names.title}
        lede={<ConversationStatus username={names.username} />}
        leading={
          <ConversationAvatar name={names.title} username={names.username} />
        }
        actions={
          <>
            {conversation === null ? null : (
              <ConversationSearch
                channelId={id.data}
                maxUnits={conversation.bounds.messageUnits}
                searchQuery={searchQuery ?? null}
              />
            )}
            <ConversationOptions channelId={id.data} isGroup={names.isGroup} />
          </>
        }
      >
        {conversation === null ? (
          <p role="status" className="flex-1 p-6 text-ink-muted">
            This conversation is unavailable. Refresh to try again.
          </p>
        ) : (
          <>
            {query.notice === markReadUnavailableNotice ? (
              // Only a no-JS reader posts the native form, so only they see it.
              <noscript>
                <p role="status" className="px-6 pt-2 text-ink-muted">
                  This conversation could not be marked read. Try again.
                </p>
              </noscript>
            ) : null}
            {readThrough === null ? null : (
              <>
                {/* With JavaScript the live history marks what it shows. */}
                <noscript>
                  <form
                    action={markReadAction.bind(null, id.data, readThrough)}
                    className="px-6 pt-2"
                  >
                    <button type="submit" className="text-accent underline">
                      Mark as read
                    </button>
                  </form>
                </noscript>
              </>
            )}
            {searchQuery === undefined && !paging ? (
              // The latest page is live on the tab's socket (ADR 0089).
              <ConversationLive
                channelId={id.data}
                history={conversation.history}
                actorId={actorId}
                otherAuthor={names.otherAuthor}
                socketUrl={conversation.socketUrl}
                typingRefetchMs={conversation.typingRefetchMs}
                viewer={conversation.viewer}
                now={now}
                typingName={names.isGroup ? 'Someone' : names.otherAuthor}
                filesAvailable={filesAvailable}
                reactAction={reactToMessageAction}
              />
            ) : (
              // Search results and older pages are explicit HTTP reads.
              <MessageHistory
                history={conversation.history}
                actorId={actorId}
                otherAuthor={names.otherAuthor}
                viewer={conversation.viewer}
                now={now}
                filesAvailable={filesAvailable}
                reactAction={reactToMessageAction}
                latestLink={paging || searchQuery !== undefined}
                {...(searchQuery === undefined ? {} : { searchQuery })}
              />
            )}
            <MessageComposer
              channelId={id.data}
              action={sendMessageAction.bind(null, id.data)}
              maxUnits={conversation.bounds.messageUnits}
              readThrough={readThrough}
              placeholder={`Message ${names.title}`}
            />
          </>
        )}
      </ConversationPane>
    </ConversationNavigation>
  );
}

/** This conversation's own inbox entry, or null when it cannot be read. */
async function readChannelEntry(channelId: string) {
  const response = await ENTRY(
    new Request(
      `http://in-process.invalid/api/messaging/channels/${channelId}/entry`,
      { headers: new Headers(await headers()) },
    ),
  );
  if (!response.ok) return null;
  const parsed = createMessagingInboxSchemas(1).entry.safeParse(
    await response.json(),
  );
  return parsed.success ? parsed.data.entry : null;
}

async function readPageConversation(channelId: string, query: SearchParams) {
  const searchQuery = typeof query.query === 'string' ? query.query : undefined;
  const input = new URLSearchParams();
  if (typeof query.before === 'string') input.set('before', query.before);
  if (searchQuery !== undefined) input.set('query', searchQuery);
  // The latest page reads the live window, so a snapshot never shrinks it.
  else if (typeof query.before !== 'string')
    input.set('limit', String(channelMessagesWindow.limit));
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
const searchTool =
  'flex size-10 cursor-pointer list-none items-center justify-center rounded-sm text-ink-muted hover:bg-surface-overlay hover:text-ink';

/** Search within this conversation: a native disclosure over a GET form. */
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
    <details open={searchQuery !== null}>
      <summary
        aria-label="Search this conversation"
        title="Search this conversation"
        className={searchTool}
      >
        <Icon name="search" />
      </summary>
      <div className="absolute inset-x-0 top-pane-header z-20 border-b border-border bg-surface px-6 py-2 max-narrow:px-4">
        <ConversationSearchForm
          action={`/messages/${channelId}`}
          method="get"
          className="flex items-center gap-3"
        >
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface-raised px-3 text-ink-muted focus-within:border-border-strong">
            <Icon name="search" size={16} />
            <span className="sr-only">Search messages</span>
            <input
              name="query"
              type="search"
              defaultValue={searchQuery ?? ''}
              maxLength={Math.min(maxUnits, messagingBetaLimits.queryUnits)}
              required
              className="h-full w-full min-w-0 bg-transparent text-sm text-ink"
            />
          </label>
          <Button type="submit" variant="secondary">
            Search
          </Button>
          {searchQuery === null ? null : (
            <Link href={`/messages/${channelId}`}>Clear search</Link>
          )}
        </ConversationSearchForm>
      </div>
    </details>
  );
}
