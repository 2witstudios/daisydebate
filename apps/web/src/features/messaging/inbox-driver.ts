import { terminalReason } from '../realtime/connection-status';
import type { SyncConnection } from '../resource-sync/driver';
import { attachMessagingInboxDoorbells } from './doorbells';
import { createInboxReads } from './inbox-reads';
import { appendPage, type MessagingInboxPageAnswer } from './inbox-view';

/** The conversation list as the tab shows it. */
export type InboxSnapshot = MessagingInboxPageAnswer & {
  /** When these rows' ages were last measured. */
  readonly now: string;
  /** False while the member's own inbox could not be read at all. */
  readonly available: boolean;
  /** The search box as typed. */
  readonly search: string;
  /** The search line the shown rows answer, or null for the whole inbox. */
  readonly appliedSearch: string | null;
};

/** Where the inbox's doorbells ring: the member's inbox topic on the tab's socket. */
export type InboxDoorbells = {
  readonly actorId: string;
  readonly socketUrl: string;
};

/** The first snapshot: the layout's seed, or an unread, empty inbox. */
export const seedInbox = (
  seed: (MessagingInboxPageAnswer & { readonly now: string }) | null,
): InboxSnapshot => ({
  entries: seed?.entries ?? [],
  nextAfter: seed?.nextAfter ?? null,
  now: seed?.now ?? '',
  available: seed !== null,
  search: '',
  appliedSearch: null,
});

/**
 * The tab's one view of the conversation list. A ring re-reads what is loaded
 * through the inbox API (never the router), so the open conversation, its
 * draft and the list's scroll stay put, and a conversation that left is gone
 * whichever page it was on. Rings say only that something changed: what
 * shows is always an authorized read.
 */
export function createInboxDriver(ports: {
  readonly seed: InboxSnapshot;
  readonly readPage: Parameters<typeof createInboxReads>[0]['readPage'];
  readonly scheduler: Parameters<typeof createInboxReads>[0]['scheduler'];
  /** The instant now, as an ISO string, for measuring row ages. */
  readonly now: () => string;
  /** The tab's realtime connection to a socket. */
  readonly connect: (socketUrl: string) => SyncConnection;
}) {
  const listeners = new Set<() => void>();
  let snapshot = ports.seed;
  let doorbell: {
    readonly to: InboxDoorbells;
    readonly authorizedSnapshot: () => void;
    readonly close: () => void;
  } | null = null;
  const publish = (next: InboxSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const reads = createInboxReads({
    readPage: ports.readPage,
    scheduler: ports.scheduler,
    onRefreshed: (page, { q }) => {
      publish({
        ...snapshot,
        ...page,
        now: ports.now(),
        available: true,
        appliedSearch: q,
      });
      doorbell?.authorizedSnapshot();
    },
    onNextPage: (page) =>
      publish({ ...snapshot, ...appendPage(snapshot, page) }),
  });
  const ring = () => reads.ring();
  const closeDoorbell = () => {
    doorbell?.close();
    doorbell = null;
  };
  return {
    readSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Something changed elsewhere (a server render, a native answer): read again. */
    ring,
    /** The search box changed; a blank line returns to the whole inbox. */
    setSearch(value: string) {
      publish({ ...snapshot, search: value });
      const line = value.trim();
      reads.search(line === '' ? null : line);
    },
    /** Whether the next page was read; a refused read leaves the native link. */
    more: (after: string) => reads.more(after),
    /** Follows the doorbells where they ring, or nowhere; a new place replaces the old. */
    follow(to: InboxDoorbells | null) {
      if (
        doorbell?.to.actorId === to?.actorId &&
        doorbell?.to.socketUrl === to?.socketUrl
      )
        return;
      closeDoorbell();
      if (to === null) return;
      const connection = ports.connect(to.socketUrl);
      const attached = attachMessagingInboxDoorbells({
        connection,
        actorId: to.actorId,
        catchUpOnSubscribe: true,
        invalidate: () => undefined,
        refetch: ring,
      });
      const unsubscribe = connection.subscribe((state) => {
        if (terminalReason(state) !== null) ring();
      });
      connection.connect();
      doorbell = {
        to,
        authorizedSnapshot: attached.authorizedSnapshot,
        close: () => {
          attached.close();
          unsubscribe();
          connection.dispose();
        },
      };
    },
    dispose() {
      reads.close();
      closeDoorbell();
      listeners.clear();
    },
  };
}

export type InboxDriver = ReturnType<typeof createInboxDriver>;
