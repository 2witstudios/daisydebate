'use client';
import { useEffect, useMemo, useState } from 'react';
import { createBrowserTypingReader } from './typing-browser';
import { tabConnection } from '../../features/realtime/browser-adapters';
import { useRealtime } from '../../features/realtime/use-realtime';
import { channelMessages } from '../../features/messaging/channel-messages';
import {
  readThroughSequence,
  type MessagingConversation,
} from '../../features/messaging/conversation';
import { MarkConversationRead } from './mark-read';
import { MessageHistory, type MessagingViewer } from './message-history';
import type { ReactionPillAction } from './reaction-pill';

/**
 * The conversation's latest page, live (ADR 0089): snapshots replace the
 * history in place, so nothing outside it (the composer's draft, open
 * forms) is re-rendered or refetched. Revoked access withdraws it.
 */
export function ConversationLive({
  channelId,
  history,
  actorId,
  otherAuthor,
  socketUrl,
  typingRefetchMs,
  viewer,
  now,
  typingName,
  filesAvailable,
  reactAction,
}: {
  readonly channelId: string;
  readonly history: MessagingConversation;
  readonly actorId: string | null;
  readonly otherAuthor: string;
  readonly socketUrl: string | null;
  readonly typingRefetchMs: number | null;
  readonly viewer: MessagingViewer;
  readonly now: string;
  /** Who a typing line names: a DM's @username; a group says Someone. */
  readonly typingName: string;
  readonly filesAvailable: boolean;
  readonly reactAction: ReactionPillAction;
}) {
  const descriptor = useMemo(() => channelMessages(channelId), [channelId]);
  const view = useRealtime(descriptor, history, socketUrl);
  const [typing, showTyping] = useState<boolean | null>(null);
  useEffect(() => {
    if (socketUrl === null) return;
    const connection = tabConnection(socketUrl);
    const reader = createBrowserTypingReader(
      channelId,
      connection,
      showTyping,
      typingRefetchMs,
    );
    connection.connect();
    return () => {
      reader.close();
      connection.dispose();
    };
  }, [channelId, socketUrl, typingRefetchMs]);
  if (view.status === 'hidden')
    return (
      <p role="status" className="flex-1 p-6 text-ink-muted">
        This conversation is no longer available to you.
      </p>
    );
  const shown = view.body ?? history;
  // What is on screen is what is read: a live message advances the cursor too.
  const readThrough = readThroughSequence(shown, {
    searching: false,
    paging: false,
  });
  return (
    <>
      {readThrough === null ? null : (
        <MarkConversationRead channelId={channelId} sequence={readThrough} />
      )}
      <MessageHistory
        history={shown}
        actorId={actorId}
        otherAuthor={otherAuthor}
        viewer={viewer}
        now={now}
        filesAvailable={filesAvailable}
        reactAction={reactAction}
        observed={socketUrl !== null}
      />
      {/* Reserved, so a typing line never moves the conversation. */}
      <div className="h-typing-row shrink-0 px-6 pt-1 text-xs text-ink-muted max-narrow:px-4">
        {typing === true ? <p role="status">{typingName} is typing…</p> : null}
      </div>
    </>
  );
}
