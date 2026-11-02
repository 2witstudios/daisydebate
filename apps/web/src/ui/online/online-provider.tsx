'use client';

// First: protocol schemas built after this load without Zod's eval probe.
import '../debate-room/zod-jitless';
import {
  challengeListSchema,
  ONLINE_TOPIC,
  onlineRosterSchema,
  buildUserInboxTopic,
  type ChallengeList,
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
} from '../../features/presence/refresh-schedule';

type OnlineView = {
  readonly roster: OnlineRoster;
  readonly challenges: ChallengeList;
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

const challengeRead = challengeListSchema.loose();
const parseChallenges = (value: unknown) => {
  const parsed = challengeRead.safeParse(value, { jitless: true });
  if (!parsed.success) return null;
  return {
    list: parsed.data as ChallengeList,
    actorId:
      typeof parsed.data['actorId'] === 'string'
        ? parsed.data['actorId']
        : null,
  };
};

const rosterUrl = (filter: OnlineFilter, query: string, cursor?: string) => {
  const search = new URLSearchParams({ filter });
  if (query.trim()) search.set('q', query.trim());
  if (cursor) search.set('cursor', cursor);
  return `/api/online?${search}`;
};

/**
 * The tab's one view of who is online and its challenges (ADR 0097). The page
 * opens with the server's read, a ring on the shared socket asks for a fresh
 * one, and a timer covers a ring that never comes. Rings say only that
 * something changed, so what a member sees is always an authorized read.
 */
export function OnlineProvider({
  initialRoster,
  initialChallenges,
  actorId: initialActorId,
  socketUrl: initialSocketUrl,
  children,
}: {
  readonly initialRoster: OnlineRoster;
  readonly initialChallenges: ChallengeList;
  readonly actorId: string | null;
  readonly socketUrl: string | null;
  readonly children: ReactNode;
}) {
  const [roster, setRoster] = useState(initialRoster);
  const [challenges, setChallenges] = useState(initialChallenges);
  const [filter, setFilter] = useState<OnlineFilter>('all');
  const [query, setQuery] = useState('');
  const [socketUrl, setSocketUrl] = useState(initialSocketUrl);
  const [actorId, setActorId] = useState(initialActorId);
  const lastRead = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = useRef({ filter, query, count: roster.counts.everyone });
  useEffect(() => {
    shown.current = { filter, query, count: roster.counts.everyone };
  }, [filter, query, roster.counts.everyone]);

  // A re-read walks as many pages as the viewer loaded, so a ring never
  // snatches the list out from under someone who scrolled.
  const pagesLoaded = useRef(1);
  const readRoster = useCallback(async () => {
    const { filter: wanted, query: named } = shown.current;
    lastRead.current = systemScheduler.now();
    let merged: OnlineRoster | null = null;
    for (let page = 0; page < pagesLoaded.current; page += 1) {
      const cursor: string | undefined = merged?.nextCursor ?? undefined;
      const read: {
        readonly value: OnlineRoster | null;
        readonly response: Response | null;
      } = await readJson(rosterUrl(wanted, named, cursor), parseRoster);
      const { value, response } = read;
      const endpoint = response && realtimeEndpointOf(response);
      if (endpoint) setSocketUrl(endpoint);
      if (!value) return;
      const next: OnlineRoster = merged
        ? { ...value, members: [...merged.members, ...value.members] }
        : value;
      merged = next;
      if (!next.nextCursor) break;
    }
    if (
      merged &&
      shown.current.filter === wanted &&
      shown.current.query === named
    )
      setRoster(merged);
  }, []);
  const readChallenges = useCallback(async () => {
    const { value } = await readJson('/api/challenges', parseChallenges);
    if (!value) return;
    setChallenges(value.list);
    if (value.actorId) setActorId(value.actorId);
  }, []);
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
    const handle = setTimeout(() => void readRoster(), 200);
    return () => clearTimeout(handle);
  }, [filter, query, readRoster]);

  // The fallback when no ring arrives, and the first read that names the socket.
  useEffect(() => {
    if (socketUrl === null) void readRoster();
    const poll = setInterval(() => {
      void readRoster();
      void readChallenges();
    }, ROSTER_CEILING_MS);
    return () => clearInterval(poll);
  }, [readChallenges, readRoster, socketUrl]);

  useEffect(() => {
    if (socketUrl === null) return;
    const connection = tabConnection(socketUrl);
    connection.connect();
    const stopRoster = connection.subscribeTopic(ONLINE_TOPIC, (frame) => {
      if (frame.type === 'online_changed' || frame.type === 'subscribed')
        schedule();
    });
    const stopChallenges = actorId
      ? connection.subscribeTopic(buildUserInboxTopic(actorId), (frame) => {
          if (
            frame.type === 'event' &&
            frame.payload.kind === 'challenge.changed'
          )
            void readChallenges();
        })
      : undefined;
    return () => {
      stopRoster();
      stopChallenges?.();
      connection.dispose();
    };
  }, [actorId, readChallenges, schedule, socketUrl]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const loadMore = useCallback(() => {
    const cursor = roster.nextCursor;
    if (!cursor) return;
    void readJson(rosterUrl(filter, query, cursor), parseRoster).then(
      ({ value }) => {
        if (value) pagesLoaded.current += 1;
        if (value)
          setRoster((current) => ({
            ...value,
            members: [...current.members, ...value.members],
          }));
      },
    );
  }, [filter, query, roster.nextCursor]);
  const refresh = useCallback(() => {
    void readRoster();
    void readChallenges();
  }, [readChallenges, readRoster]);

  const view = useMemo(
    () => ({
      roster,
      challenges,
      filter,
      query,
      setFilter,
      setQuery,
      loadMore,
      refresh,
    }),
    [challenges, filter, loadMore, query, refresh, roster],
  );
  return (
    <OnlineContext.Provider value={view}>{children}</OnlineContext.Provider>
  );
}
