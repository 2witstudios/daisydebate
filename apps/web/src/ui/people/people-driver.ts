import { ONLINE_TOPIC } from '@daisy/protocol/topics';
import type { PeopleFilter, PeopleList } from '@daisy/protocol/people-list';
import type { ServerMessage } from '@daisy/protocol/realtime-server';
import {
  nextReadDelayMs,
  PEOPLE_READ_CEILING_MS,
  peopleReadCount,
  peopleReadFloorMs,
} from '../../features/presence/refresh-schedule';
import { mergePages } from './merge-pages';

/** What the people list shows and what it was asked for. */
export type PeopleSnapshot = {
  readonly list: PeopleList;
  readonly filter: PeopleFilter;
  readonly query: string;
  /** The socket the list hears its rings on, as last named; null for none. */
  readonly socketUrl: string | null;
};

/** One page of the list: null when it could not be read; the socket a read names. */
export type PeopleRead = {
  readonly list: PeopleList | null;
  readonly socketUrl: string | null;
};

/** The realtime connection the list hears its rings on. */
export type PeopleConnection = {
  readonly subscribeTopic: (
    topic: string,
    listener: (frame: ServerMessage) => void,
  ) => () => void;
  readonly connect: () => void;
  readonly dispose: () => void;
};

/** How long a filter or search waits for typing to pause. */
const SEARCH_PAUSE_MS = 200;

export const seedPeople = (
  list: PeopleList,
  socketUrl: string | null,
): PeopleSnapshot => ({ list, filter: 'all', query: '', socketUrl });

/**
 * The tab's one view of the people list (ADR 0105). It opens with the
 * server's read; a ring on the shared socket asks for a fresh one, and a
 * timer covers a ring that never comes. Rings say only that something
 * changed, so what a member sees is always an authorized read. A re-read
 * walks every page the viewer loaded, one read runs at a time, and only the
 * newest question's answer lands.
 */
export function createPeopleDriver(ports: {
  readonly seed: PeopleSnapshot;
  readonly read: (query: {
    readonly filter: PeopleFilter;
    readonly query: string;
    readonly cursor?: string;
  }) => Promise<PeopleRead>;
  readonly scheduler: {
    readonly now: () => number;
    readonly after: (run: () => void, ms: number) => () => void;
    readonly every: (run: () => void, ms: number) => () => void;
  };
  /** A unit value that spreads the fleet's reads. */
  readonly jitter: () => number;
  readonly connect: (socketUrl: string) => PeopleConnection;
}) {
  const { scheduler } = ports;
  const listeners = new Set<() => void>();
  let snapshot = ports.seed;
  let disposed = false;
  // Read live: dispose() can run during any await, which narrowing cannot see.
  const isDisposed = () => disposed;
  // The server rendered this list a moment ago, so the first ring waits its turn.
  let lastReadAt = scheduler.now();
  /** A re-read walks as many pages as the viewer loaded. */
  let pagesLoaded = 1;
  /** Only the newest question's read may land, so an old answer never undoes a block. */
  let question = 0;
  let reading = false;
  let readAgain = false;
  let loadingMore = false;
  let following = false;
  let cancelRing: (() => void) | null = null;
  let cancelSearch: () => void = () => undefined;
  let cancelTick: () => void = () => undefined;
  let closeSocket: () => void = () => undefined;

  const publish = (next: Partial<PeopleSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  };
  const count = () => peopleReadCount(snapshot.list);

  const readList = async (): Promise<void> => {
    if (disposed) return;
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    const { filter, query } = snapshot;
    const asked = question;
    lastReadAt = scheduler.now();
    let merged: PeopleList | null = null;
    let complete = true;
    for (let page = 0; page < pagesLoaded; page += 1) {
      const cursor = merged?.nextCursor ?? undefined;
      const answer = await ports.read({
        filter,
        query,
        ...(cursor ? { cursor } : {}),
      });
      if (isDisposed()) return;
      if (answer.socketUrl) follow(answer.socketUrl);
      if (!answer.list) {
        complete = false;
        break;
      }
      merged = merged ? mergePages(merged, answer.list) : answer.list;
      if (!merged.nextCursor) break;
    }
    if (complete && merged && asked === question) publish({ list: merged });
    reading = false;
    if (readAgain) {
      readAgain = false;
      void readList();
    }
  };

  /** A ring: one pending re-read, never inside the floor since the last read. */
  const ring = () => {
    if (cancelRing !== null) return;
    const waitMs = nextReadDelayMs({
      now: scheduler.now(),
      lastReadAt,
      peopleCount: count(),
      jitter: ports.jitter(),
    });
    cancelRing = scheduler.after(() => {
      cancelRing = null;
      void readList();
    }, waitMs);
  };

  /** The socket the list hears its rings on; the fallback tick restarts with it. */
  const follow = (next: string | null) => {
    if (following && snapshot.socketUrl === next) return;
    following = true;
    if (snapshot.socketUrl !== next) publish({ socketUrl: next });
    closeSocket();
    cancelTick();
    if (next === null) void readList();
    cancelTick = scheduler.every(() => {
      if (scheduler.now() - lastReadAt >= peopleReadFloorMs(count()))
        void readList();
    }, PEOPLE_READ_CEILING_MS);
    if (next === null) {
      closeSocket = () => undefined;
      return;
    }
    const connection = ports.connect(next);
    connection.connect();
    const stopRings = connection.subscribeTopic(ONLINE_TOPIC, (frame) => {
      if (frame.type === 'online_changed' || frame.type === 'subscribed')
        ring();
    });
    closeSocket = () => {
      stopRings();
      connection.dispose();
    };
  };
  /** A changed filter or search starts over from one page and reads once typing pauses. */
  const askAgain = (
    next: Partial<Pick<PeopleSnapshot, 'filter' | 'query'>>,
  ) => {
    const changed =
      (next.filter !== undefined && next.filter !== snapshot.filter) ||
      (next.query !== undefined && next.query !== snapshot.query);
    if (!changed) return;
    publish(next);
    pagesLoaded = 1;
    question += 1;
    cancelSearch();
    cancelSearch = scheduler.after(() => void readList(), SEARCH_PAUSE_MS);
  };

  follow(snapshot.socketUrl);

  return {
    readSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setFilter: (filter: PeopleFilter) => askAgain({ filter }),
    setQuery: (query: string) => askAgain({ query }),
    /** The next page of the question now asked. */
    loadMore() {
      const cursor = snapshot.list.nextCursor;
      if (!cursor || loadingMore) return;
      loadingMore = true;
      const asked = question;
      const { filter, query } = snapshot;
      void ports.read({ filter, query, cursor }).then(({ list }) => {
        loadingMore = false;
        if (disposed || !list || asked !== question) return;
        pagesLoaded += 1;
        publish({ list: mergePages(snapshot.list, list) });
      });
    },
    /** Re-reads at once, after the member's own action. */
    refresh: () => void readList(),
    dispose() {
      disposed = true;
      cancelRing?.();
      cancelSearch();
      cancelTick();
      closeSocket();
      listeners.clear();
    },
  };
}
