'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { systemClock } from '@daisy/clock';
import { readMessagingInboxResponse } from '../../features/messaging/inbox-response';
import {
  appendPage,
  mergeFirstPage,
  type MessagingInboxPageAnswer,
} from '../../features/messaging/inbox-view';
import { createInboxReads } from '../../features/messaging/inbox-reads';
import { attachMessagingInboxDoorbells } from '../../features/messaging/doorbells';
import { tabConnection } from '../../features/realtime/browser-adapters';

type InboxState = MessagingInboxPageAnswer & {
  /** When these rows' ages were last measured. */
  readonly now: string;
};
type Inbox = InboxState & {
  /** False while the member's own inbox could not be read at all. */
  readonly available: boolean;
  readonly search: string;
  readonly searching: boolean;
  readonly setSearch: (value: string) => void;
  /** Whether the next page was read; a refused read leaves the native link. */
  readonly more: (after: string) => Promise<boolean>;
};
const InboxContext = createContext<Inbox | null>(null);

export const useInbox = () => {
  const inbox = useContext(InboxContext);
  if (inbox === null) throw new Error('The inbox requires its provider');
  return inbox;
};

const readPage = async ({
  q,
  after,
}: {
  readonly q: string | null;
  readonly after: string | null;
}) => {
  const params = new URLSearchParams();
  if (q !== null) params.set('q', q);
  if (after !== null) params.set('after', after);
  const query = params.size > 0 ? `?${params}` : '';
  return readMessagingInboxResponse(
    await fetch(`/api/messaging/inbox${query}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    }),
  );
};

/**
 * The tab's one view of the conversation list. The layout seeds it, and a ring
 * asks for a fresh read through the inbox API, never the router, so the open
 * conversation, its draft and this list's scroll and loaded pages stay put.
 * Rings say only that something changed: what shows is always an authorized read.
 */
export function InboxProvider({
  seed,
  actorId,
  socketUrl,
  children,
}: {
  readonly seed: (MessagingInboxPageAnswer & { readonly now: string }) | null;
  readonly actorId: string;
  readonly socketUrl: string | null;
  readonly children: ReactNode;
}) {
  const empty = { entries: [], nextAfter: null };
  const [view, setView] = useState<InboxState>({
    ...(seed ?? empty),
    now: seed?.now ?? '',
  });
  const [available, setAvailable] = useState(seed !== null);
  const [search, setSearchValue] = useState('');
  const [searchedFor, setSearchedFor] = useState<string | null>(null);
  const reader = useRef<ReturnType<typeof createInboxReads> | null>(null);
  const doorbell = useRef<ReturnType<
    typeof attachMessagingInboxDoorbells
  > | null>(null);
  const [seenSeed, setSeenSeed] = useState(seed);
  // A server render elsewhere (a native answer, a refresh) brought a fresh read.
  if (seed !== seenSeed) {
    setSeenSeed(seed);
    if (seed !== null && searchedFor === null) {
      setAvailable(true);
      setView((current) => ({
        ...mergeFirstPage(current, seed),
        now: seed.now,
      }));
    }
  }
  useEffect(() => {
    const reads = createInboxReads({
      readPage,
      scheduler: {
        after: (work, ms) => {
          const timer = setTimeout(work, ms);
          return () => clearTimeout(timer);
        },
      },
      onFirstPage: (page, { q, searchChanged }) => {
        setAvailable(true);
        setSearchedFor(q);
        setView((current) => ({
          ...(searchChanged ? page : mergeFirstPage(current, page)),
          now: systemClock.now(),
        }));
        doorbell.current?.authorizedSnapshot();
      },
      onNextPage: (page) =>
        setView((current) => ({
          ...appendPage(current, page),
          now: current.now,
        })),
    });
    reader.current = reads;
    return () => {
      reads.close();
      reader.current = null;
    };
  }, []);
  useEffect(() => {
    if (socketUrl === null) return;
    const connection = tabConnection(socketUrl);
    const attached = attachMessagingInboxDoorbells({
      connection,
      actorId,
      invalidate: () => undefined,
      refetch: () => reader.current?.ring(),
    });
    doorbell.current = attached;
    const unsubscribe = connection.subscribe((state) => {
      if (state.terminal !== null) reader.current?.ring();
    });
    connection.connect();
    return () => {
      attached.close();
      unsubscribe();
      connection.dispose();
      doorbell.current = null;
    };
  }, [actorId, socketUrl]);
  const setSearch = useCallback((value: string) => {
    setSearchValue(value);
    const line = value.trim();
    reader.current?.search(line === '' ? null : line);
  }, []);
  const more = useCallback(
    (after: string) => reader.current?.more(after) ?? Promise.resolve(false),
    [],
  );
  const inbox = useMemo(
    () => ({
      ...view,
      available,
      search,
      searching: searchedFor !== null,
      setSearch,
      more,
    }),
    [view, available, search, searchedFor, setSearch, more],
  );
  return (
    <InboxContext.Provider value={inbox}>{children}</InboxContext.Provider>
  );
}
