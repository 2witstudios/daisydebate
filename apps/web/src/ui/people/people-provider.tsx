'use client';

// First: protocol schemas built after this load without Zod's eval probe.
import '../../lib/zod-jitless';
import {
  browserTransport,
  type BrowserTransport,
} from '../edge/browser-request';
import { browserScheduler } from '../edge/browser-time';
import { useDriver } from '../edge/use-driver';
import {
  peopleListSchema,
  type PeopleFilter,
  type PeopleList,
} from '@daisy/protocol/people-list';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { realtimeEndpointOf } from '../../features/realtime/endpoint-header';
import {
  secureRandom,
  systemScheduler,
  tabConnection,
} from '../edge/realtime-browser';
import {
  createPeopleDriver,
  seedPeople,
  type PeopleRead,
  type PeopleSnapshot,
} from './people-driver';

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

/** One page of the list through the browser's transport; a failed read is a null list. */
const readPeople =
  (transport: BrowserTransport) =>
  async ({
    filter,
    query,
    cursor,
  }: {
    readonly filter: PeopleFilter;
    readonly query: string;
    readonly cursor?: string;
  }): Promise<PeopleRead> => {
    try {
      const response = await transport(listUrl(filter, query, cursor), {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      return {
        list: response.ok ? parseList(await response.json()) : null,
        socketUrl: realtimeEndpointOf(response),
      };
    } catch {
      return { list: null, socketUrl: null };
    }
  };

/** The people list on the browser's transport, timers, randomness and tab socket. */
const startPeople = (seed: PeopleSnapshot) =>
  createPeopleDriver({
    seed,
    read: readPeople(browserTransport),
    scheduler: {
      now: systemScheduler.now,
      after: browserScheduler.after,
      every: browserScheduler.every,
    },
    jitter: secureRandom,
    connect: tabConnection,
  });

/** The tab's one view of the people list (`createPeopleDriver`, ADR 0105). */
export function PeopleProvider({
  initialList,
  socketUrl,
  children,
}: {
  readonly initialList: PeopleList;
  readonly socketUrl: string | null;
  readonly children: ReactNode;
}) {
  // The socket the page rendered with is the first one; reads name any later one.
  const [{ list, filter, query }, driver] = useDriver(
    () => seedPeople(initialList, socketUrl),
    startPeople,
  );
  const view = useMemo(
    () => ({
      list,
      filter,
      query,
      setFilter: (next: PeopleFilter) => driver?.setFilter(next),
      setQuery: (next: string) => driver?.setQuery(next),
      loadMore: () => driver?.loadMore(),
      refresh: () => driver?.refresh(),
    }),
    [list, filter, query, driver],
  );
  return (
    <PeopleContext.Provider value={view}>{children}</PeopleContext.Provider>
  );
}
