'use client';

// First: protocol schemas built after this load without Zod's eval probe.
import '../../lib/zod-jitless';
import {
  ONLINE_TOPIC,
  peopleListSchema,
  type PeopleFilter,
  type PeopleList,
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
  PEOPLE_READ_CEILING_MS,
  peopleReadCount,
  peopleReadFloorMs,
} from '../../features/presence/refresh-schedule';
import { mergePages } from './merge-pages';

type PeopleView = {
  readonly list: PeopleList;
  readonly filter: PeopleFilter;
  readonly query: string;
  readonly setFilter: (filter: PeopleFilter) => void;
  readonly setQuery: (query: string) => void;
  readonly loadMore: () => void;
  /** Re-reads at once, after the member's own action. */
  readonly refresh: () => void;
};

const PeopleContext = createContext<PeopleView | null>(null);

export const usePeople = (): PeopleView => {
  const view = useContext(PeopleContext);
  if (!view) throw new Error('usePeople needs a PeopleProvider');
  return view;
};

/** Self status for the avatar, or null outside a member's shell. */
export const useOptionalPeople = () => useContext(PeopleContext);

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

const parseList = (value: unknown) => {
  // jitless: the strict CSP refuses Zod's eval-compiled parser.
  const parsed = peopleListSchema.safeParse(value, { jitless: true });
  return parsed.success ? parsed.data : null;
};

const listUrl = (filter: PeopleFilter, query: string, cursor?: string) => {
  const search = new URLSearchParams({ filter });
  if (query.trim()) search.set('q', query.trim());
  if (cursor) search.set('cursor', cursor);
  return `/api/people?${search}`;
};

/**
 * The tab's one view of the people list (ADR 0105). The page
 * opens with the server's read, a ring on the shared socket asks for a fresh
 * one, and a timer covers a ring that never comes. Rings say only that
 * something changed, so what a member sees is always an authorized read.
 */
export function PeopleProvider({
  initialList,
  socketUrl: initialSocketUrl,
  children,
}: {
  readonly initialList: PeopleList;
  readonly socketUrl: string | null;
  readonly children: ReactNode;
}) {
  const [list, setList] = useState(initialList);
  const [filter, setFilter] = useState<PeopleFilter>('all');
  const [query, setQuery] = useState('');
  const [socketUrl, setSocketUrl] = useState(initialSocketUrl);
  const lastRead = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const count = peopleReadCount(list);
  const shown = useRef({ filter, query, count });
  useEffect(() => {
    shown.current = { filter, query, count };
  }, [filter, query, count]);

  // A re-read walks as many pages as the viewer loaded, so a ring never
  // snatches the list out from under someone who scrolled.
  const pagesLoaded = useRef(1);
  // Only the newest read may land, so an old answer never undoes a block.
  const readSeq = useRef(0);
  // One read at a time: a ring during a read asks for one more after it, so
  // steady rings can never keep superseding a slow read until nothing lands.
  const reading = useRef(false);
  const readAgain = useRef(false);
  const readList = useCallback(async () => {
    if (reading.current) {
      readAgain.current = true;
      return;
    }
    reading.current = true;
    const { filter: wanted, query: named } = shown.current;
    const seq = readSeq.current;
    lastRead.current = systemScheduler.now();
    let merged: PeopleList | null = null;
    let complete = true;
    for (let page = 0; page < pagesLoaded.current; page += 1) {
      const cursor: string | undefined = merged?.nextCursor ?? undefined;
      const read: {
        readonly value: PeopleList | null;
        readonly response: Response | null;
      } = await readJson(listUrl(wanted, named, cursor), parseList);
      const { value, response } = read;
      const endpoint = response && realtimeEndpointOf(response);
      if (endpoint) setSocketUrl(endpoint);
      if (!value) {
        complete = false;
        break;
      }
      const next: PeopleList = merged ? mergePages(merged, value) : value;
      merged = next;
      if (!next.nextCursor) break;
    }
    if (complete && merged && seq === readSeq.current) setList(merged);
    reading.current = false;
    if (readAgain.current) {
      readAgain.current = false;
      void readListRef.current();
    }
  }, []);
  const readListRef = useRef(readList);
  const schedule = useCallback(() => {
    if (timer.current !== null) return;
    timer.current = setTimeout(
      () => {
        timer.current = null;
        void readList();
      },
      nextReadDelayMs({
        now: systemScheduler.now(),
        lastReadAt: lastRead.current,
        peopleCount: shown.current.count,
        jitter: secureRandom(),
      }),
    );
  }, [readList]);

  // A changed filter or search reads at once.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    pagesLoaded.current = 1;
    readSeq.current += 1;
    const handle = setTimeout(() => void readList(), 200);
    return () => clearTimeout(handle);
  }, [filter, query, readList]);

  // The fallback when no ring arrives, and the first read that names the socket.
  useEffect(() => {
    if (socketUrl === null) void readList();
    const poll = setInterval(() => {
      const since = systemScheduler.now() - lastRead.current;
      if (since >= peopleReadFloorMs(shown.current.count)) void readList();
    }, PEOPLE_READ_CEILING_MS);
    return () => clearInterval(poll);
  }, [readList, socketUrl]);

  useEffect(() => {
    if (socketUrl === null) return;
    const connection = tabConnection(socketUrl);
    connection.connect();
    const stopRings = connection.subscribeTopic(ONLINE_TOPIC, (frame) => {
      if (frame.type === 'online_changed' || frame.type === 'subscribed')
        schedule();
    });
    return () => {
      stopRings();
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
    const cursor = list.nextCursor;
    if (!cursor || loadingMore.current) return;
    loadingMore.current = true;
    const seq = readSeq.current;
    void readJson(listUrl(filter, query, cursor), parseList).then(
      ({ value }) => {
        loadingMore.current = false;
        if (!value || seq !== readSeq.current) return;
        pagesLoaded.current += 1;
        setList((current) => mergePages(current, value));
      },
    );
  }, [filter, query, list.nextCursor]);

  const refresh = useCallback(() => {
    void readList();
  }, [readList]);

  const view = useMemo(
    () => ({
      list,
      filter,
      query,
      setFilter,
      setQuery,
      loadMore,
      refresh,
    }),
    [filter, loadMore, query, refresh, list],
  );
  return (
    <PeopleContext.Provider value={view}>{children}</PeopleContext.Provider>
  );
}
