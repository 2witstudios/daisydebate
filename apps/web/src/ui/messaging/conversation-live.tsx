'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { MessagingCoreBounds } from '@daisy/protocol';
import { createBrowserTypingReader } from './typing-browser';
import { MessageHistory } from './message-history';
import { createBrowserConnectionStore } from '../../features/realtime/browser-adapters';
import { attachMessagingInboxDoorbells } from '../../features/messaging/doorbells';
import { channelMessages } from '../../features/messaging/channel-observation';
import {
  useRealtime,
  useRealtimeConnection,
} from '../realtime/realtime-provider';

function useTyping(channelId: string, refetchMs: number | null) {
  const connection = useRealtimeConnection();
  const [typing, showTyping] = useState<boolean | null>(null);
  useEffect(() => {
    if (!connection) return;
    const reader = createBrowserTypingReader(
      channelId,
      connection,
      showTyping,
      refetchMs,
    );
    return () => reader.close();
  }, [channelId, connection, refetchMs]);
  return typing === true;
}
function useChannel(
  channelId: string,
  bounds: MessagingCoreBounds,
  before: number | null,
  live = true,
) {
  const { messageUnits, pageItems } = bounds;
  const descriptor = useMemo(
    () =>
      live
        ? channelMessages(channelId, { messageUnits, pageItems }, before)
        : null,
    [channelId, messageUnits, pageItems, before, live],
  );
  return useRealtime(descriptor);
}

/** Server-rendered history until the live window arrives; then the shared
 * snapshot. Withdrawn authority hides content instead of reviving stale HTML. */
export function ConversationLive({
  channelId,
  bounds,
  before,
  live,
  actorId,
  typingRefetchMs,
  children,
}: {
  readonly channelId: string;
  readonly bounds: MessagingCoreBounds;
  readonly before: number | null;
  /** Search results are explicit bounded reads, never live variants. */
  readonly live: boolean;
  readonly actorId: string | null;
  readonly typingRefetchMs: number | null;
  readonly children: ReactNode;
}) {
  const view = useChannel(channelId, bounds, before, live);
  const typing = useTyping(channelId, typingRefetchMs);
  if (view.status === 'denied' || view.withdrawn)
    return <p role="status">Conversation unavailable.</p>;
  return (
    <>
      {view.content === null ? (
        children
      ) : (
        <MessageHistory
          actorId={actorId}
          history={{
            channelId,
            messages: view.content.messages,
            nextBefore:
              view.content.continuation === null
                ? null
                : { channelId, sequence: view.content.continuation },
          }}
        />
      )}
      {typing ? <p role="status">Someone is typing…</p> : null}
    </>
  );
}

/** The edit form stays mounted across content snapshots so a draft survives;
 * revocation or removal of the message unmounts it with its server text. */
export function MessageEditLive({
  channelId,
  messageId,
  bounds,
  before,
  children,
}: {
  readonly channelId: string;
  readonly messageId: string;
  readonly bounds: MessagingCoreBounds;
  readonly before: number | null;
  readonly children: ReactNode;
}) {
  const view = useChannel(channelId, bounds, before);
  if (view.status === 'denied' || view.withdrawn)
    return <p role="status">Conversation unavailable.</p>;
  const current = view.content?.messages.find(
    (message) => message.id === messageId,
  );
  if (view.content !== null && (!current || 'unavailable' in current))
    return <p role="status">Message removed.</p>;
  return <>{children}</>;
}

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
    const connection = createBrowserConnectionStore(socketUrl);
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
