'use client';

// First: protocol schemas built after this load without Zod's eval probe.
import { browserFetch } from '../edge/browser-request';
import '../../lib/zod-jitless';
import { messagingUnreadSchema, type MessagingUnread } from '@daisy/protocol';
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import {
  createMessagesUnreadSyncDriver,
  seedMessagesUnreadSync,
} from '../../features/messaging/unread-sync-driver';
import { browserSyncEdges } from '../../features/resource-sync/browser';
import type { ResourceRead } from '../../features/resource-sync/driver';
import { useDriver } from '../edge/use-driver';

const UnreadContext = createContext<number>(0);

/** Conversations waiting on the member, for the Messages badge; 0 for a visitor. */
export const useMessagesUnread = (): number => useContext(UnreadContext);

const readUnread = async (): Promise<ResourceRead<MessagingUnread>> => {
  const response = await browserFetch('/api/messaging/unread', {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  // jitless: the strict CSP refuses Zod's eval-compiled parser.
  const parsed = messagingUnreadSchema.safeParse(
    response.ok ? await response.json() : null,
    { jitless: true },
  );
  return parsed.success
    ? { kind: 'found', value: parsed.data }
    : { kind: 'unavailable' };
};

/** Messaging's own badge count for the tab (ADR 0144): it never toasts. */
export function MessagesUnreadProvider({
  actorId,
  socketUrl,
  children,
}: {
  readonly actorId: string;
  readonly socketUrl: string | null;
  readonly children: ReactNode;
}) {
  // The first read lands after hydration: the badge starts empty.
  const [seed] = useState<MessagingUnread>({ version: 1, unread: 0 });
  const start = useCallback(() => {
    const { connection, ...edges } = browserSyncEdges(socketUrl);
    const driver = createMessagesUnreadSyncDriver({
      seed,
      read: readUnread,
      inbox: connection ? { actorId, connection } : null,
      ...edges,
    });
    driver.signal();
    return driver;
  }, [actorId, seed, socketUrl]);
  const [sync] = useDriver(() => seedMessagesUnreadSync(seed, 0), start);
  return (
    <UnreadContext.Provider value={sync.value.unread}>
      {children}
    </UnreadContext.Provider>
  );
}
