'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserTypingReader } from './typing-browser';
import { tabConnection } from '../../features/realtime/browser-adapters';
import { useRealtime } from '../../features/realtime/use-realtime';
import { channelMessages } from '../../features/messaging/channel-messages';
import type { MessagingConversation } from '../../features/messaging/conversation';
import { attachMessagingInboxDoorbells } from '../../features/messaging/doorbells';
import { MessageHistory } from './message-history';

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
}: {
  readonly channelId: string;
  readonly history: MessagingConversation;
  readonly actorId: string | null;
  readonly otherAuthor: string;
  readonly socketUrl: string | null;
  readonly typingRefetchMs: number | null;
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
      <p role="status" className="text-ink-muted">
        This conversation is no longer available to you.
      </p>
    );
  return (
    <>
      <MessageHistory
        history={view.body ?? history}
        actorId={actorId}
        otherAuthor={otherAuthor}
      />
      {typing === true ? <p role="status">Someone is typing…</p> : null}
    </>
  );
}

/** The inbox stays on its actor-scoped doorbell until it adopts observation. */
export function InboxLive({
  actorId,
  socketUrl,
  snapshotId,
  children,
}: {
  readonly actorId: string;
  readonly socketUrl: string | null;
  readonly snapshotId: string;
  readonly children: ReactNode;
  readonly typingRefetchMs?: number | null;
}) {
  const router = useRouter();
  const [invalidated, invalidate] = useState<string | null>(null);
  const currentSnapshot = useRef(snapshotId);
  const reader = useRef<ReturnType<
    typeof attachMessagingInboxDoorbells
  > | null>(null);
  useEffect(() => {
    currentSnapshot.current = snapshotId;
    reader.current?.authorizedSnapshot();
  }, [snapshotId]);
  useEffect(() => {
    if (socketUrl === null) return;
    const connection = tabConnection(socketUrl);
    const attached = attachMessagingInboxDoorbells({
      connection,
      actorId,
      invalidate: () => invalidate(currentSnapshot.current),
      refetch: () => router.refresh(),
    });
    reader.current = attached;
    const unsubscribe = connection.subscribe((state) => {
      if (state.terminal !== null) {
        invalidate(currentSnapshot.current);
        router.refresh();
      }
    });
    connection.connect();
    return () => {
      attached.close();
      unsubscribe();
      connection.dispose();
      reader.current = null;
    };
  }, [actorId, socketUrl, router]);
  return invalidated === snapshotId ? (
    <p role="status" className="text-ink-muted">
      Refreshing messages…
    </p>
  ) : (
    <>{children}</>
  );
}
