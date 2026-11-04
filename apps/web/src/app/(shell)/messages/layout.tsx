import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { systemClock } from '@daisy/clock';
import { messagingRetainedSchemas } from '@daisy/protocol';
import { readMessagingInboxResponse } from '../../../features/messaging/inbox-response';
import {
  privateGroupsOffered,
  requestIdentity,
} from '../../../lib/request-session';
import { ConversationList } from '../../../ui/messaging/conversation-list';
import { InboxProvider } from '../../../ui/messaging/inbox-provider';
import { RetainedConversationList } from '../../../ui/messaging/retained-list';
import { GET as inboxRoute } from '../../api/messaging/inbox/route';
import { GET as retainedRoute } from '../../api/messaging/retained/route';

/** The survivor's retained conversations (DEC-126), or none when unreadable. */
async function readRetainedConversations(response: Response) {
  if (!response.ok) return [];
  const parsed = messagingRetainedSchemas.list.safeParse(await response.json());
  return parsed.success ? parsed.data.conversations : [];
}

/** An unreadable inbox is the list's honest state, never the page's failure. */
const readSeed = async (incoming: Headers) => {
  try {
    return await readMessagingInboxResponse(
      await inboxRoute(
        new Request('http://in-process.invalid/api/messaging/inbox', {
          headers: new Headers(incoming),
        }),
      ),
    );
  } catch {
    return null;
  }
};

/**
 * Messages between the shell's rails: the conversation list beside whichever
 * route is open. The list stays across navigation, and each page still checks
 * its own access: anyone else sees just that page's own answer.
 */
export default async function MessagesLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const identity = await requestIdentity();
  if (identity.state !== 'member') return <>{children}</>;
  const incoming = await headers();
  const [inbox, retained] = await Promise.all([
    readSeed(incoming),
    retainedRoute(
      new Request('http://in-process.invalid/api/messaging/retained', {
        headers: new Headers(incoming),
      }),
    )
      .then(readRetainedConversations)
      .catch(() => []),
  ]);
  return (
    <InboxProvider
      actorId={identity.principal.actorId}
      socketUrl={inbox?.socketUrl ?? null}
      seed={
        inbox && {
          entries: inbox.entries,
          nextAfter: inbox.nextAfter,
          now: systemClock.now(),
        }
      }
    >
      <div className="messages-frame">
        <section
          aria-label="Conversation list"
          className="messages-list-pane flex w-conversation-list shrink-0 flex-col border-r border-border bg-surface"
        >
          <ConversationList
            groupsOffered={privateGroupsOffered()}
            retained={<RetainedConversationList conversations={retained} />}
          />
        </section>
        <section
          aria-label="Conversation"
          className="flex messages-open-pane min-w-0 flex-1 flex-col"
        >
          {children}
        </section>
      </div>
    </InboxProvider>
  );
}
