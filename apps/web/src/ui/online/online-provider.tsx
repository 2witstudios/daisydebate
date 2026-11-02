'use client';

// First: protocol schemas built after this load without Zod's eval probe.
import '../debate-room/zod-jitless';
import {
  ONLINE_TOPIC,
  onlineRosterSchema,
  type OnlineFilter,
  type OnlineRoster,
} from '@daisy/protocol';
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
import { realtimeEndpointOf } from '../../features/realtime/endpoint-header';
import {
  secureRandom,
  systemScheduler,
  tabConnection,
} from '../../features/realtime/browser-adapters';
import {
  nextReadDelayMs,
  ROSTER_CEILING_MS,
  rosterFloorMs,
} from '../../features/presence/refresh-schedule';

type OnlineView = {
  readonly roster: OnlineRoster;
  readonly filter: OnlineFilter;
  readonly query: string;
  readonly setFilter: (filter: OnlineFilter) => void;
  readonly setQuery: (query: string) => void;
  readonly loadMore: () => void;
  /** Re-reads at once, after the member's own action. */
  readonly refresh: () => void;
};

const OnlineContext = createContext<OnlineView | null>(null);

export const useOnline = (): OnlineView => {
  const view = useContext(OnlineContext);
  if (!view) throw new Error('useOnline needs an OnlineProvider');
  return view;
};

/** Self status for the avatar, or null outside a member's shell. */
export const useOptionalOnline = () => useContext(OnlineContext);

const readJson = async <T,>(
  url: string,
  parse: (value: unknown) => T | null,
): Promise<{
  readonly value: T | null;
  readonly response: Response | null;
}> => {
  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    return {
      value: response.ok ? parse(await response.json()) : null,
      response,
    };
  } catch {
    return { value: null, response: null };
  }
};

const parseRoster = (value: unknown) => {
  // jitless: the strict CSP refuses Zod's eval-compiled parser.
  const parsed = onlineRosterSchema.safeParse(value, { jitless: true });
  return parsed.success ? parsed.data : null;
};

const rosterUrl = (filter: OnlineFilter, query: string, cursor?: string) => {
  const search = new URLSearchParams({ filter });
  if (query.trim()) search.set('q', query.trim());
  if (cursor) search.set('cursor', cursor);
  return `/api/online?${search}`;
};

/**
 * The tab's one view of who is online (ADR 0098). The page
 * opens with the server's read, a ring on the shared socket asks for a fresh
 * one, and a timer covers a ring that never comes. Rings say only that
 * something changed, so what a member sees is always an authorized read.
 */
export function OnlineProvider({
  initialRoster,
  socketUrl: initialSocketUrl,
  children,
}: {
  readonly initialRoster: OnlineRoster;
  readonly socketUrl: string | null;
  readonly children: ReactNode;
}) {
  const [roster, setRoster] = useState(initialRoster);
  const [filter, setFilter] = useState<OnlineFilter>('all');
  const [query, setQuery] = useState('');
  const [socketUrl, setSocketUrl] = useState(initialSocketUrl);
  const lastRead = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = useRef({ filter, query, count: roster.counts.everyone });
  useEffect(() => {
    shown.current = { filter, query, count: roster.counts.everyone };
  }, [filter, query, roster.counts.everyone]);

  // A re-read walks as many pages as the viewer loaded, so a ring never
  // snatches the list out from under someone who scrolled.
  const pagesLoaded = useRef(1);
  // Only the newest read may land, so an old answer never undoes a block.
  const readSeq = useRef(0);
  // One read at a time: a ring during a read asks for one more after it, so
  // steady rings can never keep superseding a slow read until nothing lands.
  const reading = useRef(false);
  const readAgain = useRef(false);
  const readRoster = useCallback(async () => {
    if (reading.current) {
      readAgain.current = true;
      return;
    }
    reading.current = true;
    const { filter: wanted, query: named } = shown.current;
    const seq = readSeq.current;
    lastRead.current = systemScheduler.now();
    let merged: OnlineRoster | null = null;
    let complete = true;
    for (let page = 0; page < pagesLoaded.current; page += 1) {
      const cursor: string | undefined = merged?.nextCursor ?? undefined;
      const read: {
        readonly value: OnlineRoster | null;
        readonly response: Response | null;
      } = await readJson(rosterUrl(wanted, named, cursor), parseRoster);
      const { value, response } = read;
      const endpoint = response && realtimeEndpointOf(response);
      if (endpoint) setSocketUrl(endpoint);
      if (!value) {
        complete = false;
        break;
      }
      const next: OnlineRoster = merged
        ? { ...value, members: [...merged.members, ...value.members] }
        : value;
      merged = next;
      if (!next.nextCursor) break;
    }
    if (complete && merged && seq === readSeq.current) setRoster(merged);
    reading.current = false;
    if (readAgain.current) {
      readAgain.current = false;
      void readRosterRef.current();
    }
  }, []);
  const readRosterRef = useRef(readRoster);
  const schedule = useCallback(() => {
    if (timer.current !== null) return;
    timer.current = setTimeout(
      () => {
        timer.current = null;
        void readRoster();
      },
      nextReadDelayMs({
        now: systemScheduler.now(),
        lastReadAt: lastRead.current,
        onlineCount: shown.current.count,
        jitter: secureRandom(),
      }),
    );
  }, [readRoster]);

  // A changed filter or search reads at once.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    pagesLoaded.current = 1;
    readSeq.current += 1;
    const handle = setTimeout(() => void readRoster(), 200);
    return () => clearTimeout(handle);
  }, [filter, query, readRoster]);

  // The fallback when no ring arrives, and the first read that names the socket.
  useEffect(() => {
    if (socketUrl === null) void readRoster();
    const poll = setInterval(() => {
      const since = systemScheduler.now() - lastRead.current;
      if (since >= rosterFloorMs(shown.current.count)) void readRoster();
    }, ROSTER_CEILING_MS);
    return () => clearInterval(poll);
  }, [readRoster, socketUrl]);

  useEffect(() => {
    if (socketUrl === null) return;
    const connection = tabConnection(socketUrl);
    connection.connect();
    const stopRoster = connection.subscribeTopic(ONLINE_TOPIC, (frame) => {
      if (frame.type === 'online_changed' || frame.type === 'subscribed')
        schedule();
    });
    return () => {
      stopRoster();
      connection.dispose();
    };
  }, [schedule, socketUrl]);

  // The server rendered this list a moment ago, so the first ring waits its turn.
  useEffect(() => {
    lastRead.current = systemScheduler.now();
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const loadingMore = useRef(false);
  const loadMore = useCallback(() => {
    const cursor = roster.nextCursor;
    if (!cursor || loadingMore.current) return;
    loadingMore.current = true;
    const seq = readSeq.current;
    void readJson(rosterUrl(filter, query, cursor), parseRoster).then(
      ({ value }) => {
        loadingMore.current = false;
        if (!value || seq !== readSeq.current) return;
        pagesLoaded.current += 1;
        setRoster((current) => {
          const seen = new Set(current.members.map((m) => m.username));
          return {
            ...value,
            members: [
              ...current.members,
              ...value.members.filter((m) => !seen.has(m.username)),
            ],
          };
        });
      },
    );
  }, [filter, query, roster.nextCursor]);

  const refresh = useCallback(() => {
    void readRoster();
  }, [readRoster]);

  const view = useMemo(
    () => ({
      roster,
      filter,
      query,
      setFilter,
      setQuery,
      loadMore,
      refresh,
    }),
    [filter, loadMore, query, refresh, roster],
  );
  return (
    <OnlineContext.Provider value={view}>{children}</OnlineContext.Provider>
  );
}
