'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserConnectionStore } from '../../features/realtime/browser-adapters';
import { attachMessagingDoorbells } from '../../features/messaging/doorbells';

export function ConversationLive({
  channelId,
  socketUrl,
  snapshotId,
  children,
}: {
  readonly channelId: string;
  readonly socketUrl: string | null;
  readonly snapshotId: string;
  readonly children: ReactNode;
}) {
  const router = useRouter();
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
    const attached = attachMessagingDoorbells({
      channelId,
      connection,
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
      connection.close();
      reader.current = null;
    };
  }, [channelId, socketUrl, router]);
  return invalidated === snapshotId ? (
    <p role="status" className="text-ink-muted">
      Refreshing this conversation…
    </p>
  ) : (
    <>{children}</>
  );
}
