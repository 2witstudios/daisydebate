'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserTypingReader } from './typing-browser';
import { createBrowserConnectionStore } from '../../features/realtime/browser-adapters';
import {
  attachMessagingDoorbells,
  attachMessagingInboxDoorbells,
} from '../../features/messaging/doorbells';

function MessagingLiveSnapshot({
  scope,
  notice,
  socketUrl,
  snapshotId,
  children,
}: {
  readonly scope: { readonly kind: 'channel' | 'inbox'; readonly id: string };
  readonly notice: string;
  readonly socketUrl: string | null;
  readonly snapshotId: string;
  readonly children: ReactNode;
}) {
  const router = useRouter();
  const [typing, showTyping] = useState<boolean | null>(null);
  const [invalidated, invalidate] = useState<string | null>(null);
  const currentSnapshot = useRef(snapshotId);
  const reader = useRef<ReturnType<typeof attachMessagingDoorbells> | null>(
    null,
  );
  useEffect(() => {
    currentSnapshot.current = snapshotId;
    reader.current?.authorizedSnapshot();
  }, [snapshotId]);
  useEffect(() => {
    if (socketUrl === null) return;
    const connection = createBrowserConnectionStore(socketUrl);
    const observer = {
      connection,
      invalidate: () => invalidate(currentSnapshot.current),
      refetch: () => router.refresh(),
    };
    const attached =
      scope.kind === 'channel'
        ? attachMessagingDoorbells({ ...observer, channelId: scope.id })
        : attachMessagingInboxDoorbells({ ...observer, actorId: scope.id });
    const typingReader =
      scope.kind === 'channel'
        ? createBrowserTypingReader(scope.id, connection, showTyping)
        : null;
    reader.current = attached;
    const unsubscribe = connection.subscribe((state) => {
      if (state.terminal !== null) {
        invalidate(currentSnapshot.current);
        router.refresh();
      }
    });
    connection.connect();
    return () => {
      typingReader?.close();
      attached.close();
      unsubscribe();
      connection.close();
      reader.current = null;
    };
  }, [scope.kind, scope.id, socketUrl, router]);
  return invalidated === snapshotId ? (
    <p role="status" className="text-ink-muted">
      {notice}
    </p>
  ) : (
    <>
      {children}
      {typing === true ? <p role="status">Someone is typing…</p> : null}
    </>
  );
}

type SnapshotProps = {
  readonly socketUrl: string | null;
  readonly snapshotId: string;
  readonly children: ReactNode;
};
export function ConversationLive({
  channelId,
  ...input
}: SnapshotProps & { readonly channelId: string }) {
  return (
    <MessagingLiveSnapshot
      {...input}
      scope={{ kind: 'channel', id: channelId }}
      notice="Refreshing this conversation…"
    />
  );
}
export function InboxLive({
  actorId,
  ...input
}: SnapshotProps & { readonly actorId: string }) {
  return (
    <MessagingLiveSnapshot
      {...input}
      scope={{ kind: 'inbox', id: actorId }}
      notice="Refreshing messages…"
    />
  );
}
