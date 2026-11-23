import { virtualClock } from '@daisy/clock/testing';
import type { PeopleList, Person } from '@daisy/protocol/people-list';
import type { ServerMessage } from '@daisy/protocol/realtime-server';
import { ONLINE_TOPIC } from '@daisy/protocol/topics';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { virtualBrowserTime } from '../test-support/virtual-browser-time.test-support';
import {
  createPeopleDriver,
  seedPeople,
  type PeopleConnection,
  type PeopleRead,
} from './people-driver';

setupRitewayBun();

const person = (username: string): Person => ({
  username,
  displayName: null,
  photoId: null,
  status: 'online',
  relation: 'none',
  ratings: [
    {
      ladder: { style: 'freestyle', division: 'open' },
      rating: null,
      provisional: false,
      hidden: false,
    },
  ],
  division: 'open',
  challengeModes: [],
  wins: 0,
  losses: 0,
});
const list = (
  names: readonly string[],
  nextCursor: string | null = null,
  online = names.length,
): PeopleList => ({
  version: 1,
  people: names.map(person),
  nextCursor,
  counts: { everyone: names.length, friends: 0, online },
  self: 'online',
});

const start = (
  options: {
    readonly socketUrl?: string | null;
    readonly answer?: (query: {
      readonly filter: string;
      readonly query: string;
      readonly cursor?: string;
    }) => PeopleRead | Promise<PeopleRead>;
    readonly jitter?: number;
  } = {},
) => {
  const clock = virtualClock(1_000_000);
  const { scheduler } = virtualBrowserTime(clock);
  const reads: number[] = [];
  const log: string[] = [];
  const rings = new Map<string, (frame: ServerMessage) => void>();
  const driver = createPeopleDriver({
    seed: seedPeople(list(['ada']), options.socketUrl ?? null),
    read: async (query) => {
      reads.push(clock.nowMs());
      return (
        options.answer?.(query) ?? {
          list: list(['ada', 'bo']),
          socketUrl: null,
        }
      );
    },
    scheduler: { now: clock.nowMs, ...scheduler },
    jitter: () => options.jitter ?? 0,
    connect: (socketUrl): PeopleConnection => {
      log.push(`open ${socketUrl}`);
      return {
        subscribeTopic: (topic, listener) => {
          rings.set(`${socketUrl} ${topic}`, listener);
          return () => log.push(`stop ${socketUrl}`);
        },
        connect: () => log.push(`connect ${socketUrl}`),
        dispose: () => log.push(`dispose ${socketUrl}`),
      };
    },
  });
  const ring = (socketUrl: string, type: string) =>
    rings.get(`${socketUrl} ${ONLINE_TOPIC}`)?.({ type } as ServerMessage);
  return {
    clock,
    driver,
    reads,
    log,
    ring,
    since: (at: number) => at - 1_000_000,
  };
};

describe('people driver', () => {
  test('a ring waits out the floor since the last read, jittered', async () => {
    const { clock, driver, reads, log, ring, since } = start({
      socketUrl: 'wss://rt.test/a',
      jitter: 0.5,
    });
    ring('wss://rt.test/a', 'online_changed');
    ring('wss://rt.test/a', 'online_changed');
    await clock.advance(10_000);
    assert({
      given: 'two rings right after the server read, jitter one half',
      should: 'read once at the 2 s floor plus 500 ms',
      actual: {
        log,
        reads: reads.map(since),
        shown: driver.readSnapshot().list.people.map((row) => row.username),
      },
      expected: {
        log: ['open wss://rt.test/a', 'connect wss://rt.test/a'],
        reads: [2500],
        shown: ['ada', 'bo'],
      },
    });
  });

  test('a subscribed frame rings; other frames do not', async () => {
    const { clock, reads, ring } = start({ socketUrl: 'wss://rt.test/a' });
    ring('wss://rt.test/a', 'event');
    await clock.advance(5000);
    const quiet = reads.length;
    ring('wss://rt.test/a', 'subscribed');
    await clock.advance(5000);
    assert({
      given: 'an unrelated frame, then the subscription confirming',
      should: 'read only for the subscription',
      actual: { quiet, reads: reads.length },
      expected: { quiet: 0, reads: 1 },
    });
  });

  test('the fallback tick reads only once the floor has passed', async () => {
    const { clock, driver, reads, since } = start({
      socketUrl: 'wss://rt.test/a',
      answer: () => ({
        list: list(['ada'], null, 1400),
        socketUrl: null,
      }),
    });
    driver.refresh();
    await clock.advance(30_000);
    const afterTick = reads.length;
    await clock.advance(30_000);
    assert({
      given: '1,400 online (a 28 s floor) and a read at the start',
      should: 'read again on the second tick, the first being inside the floor',
      actual: { afterTick, reads: reads.map(since) },
      expected: { afterTick: 2, reads: [0, 30_000, 60_000] },
    });
  });

  test('a read that names a new socket moves the rings there', async () => {
    const { clock, log } = start({
      answer: () => ({ list: list(['ada']), socketUrl: 'wss://rt.test/b' }),
    });
    await clock.advance(0);
    assert({
      given: 'no socket at first, and a read that names one',
      should: 'read at once and then follow the named socket',
      actual: log,
      expected: ['open wss://rt.test/b', 'connect wss://rt.test/b'],
    });
  });

  test('a changed filter starts over from one page', async () => {
    const asked: string[] = [];
    const { clock, driver } = start({
      answer: (query) => {
        asked.push(`${query.filter} ${query.query} ${query.cursor ?? '-'}`);
        return query.cursor
          ? { list: list(['cy']), socketUrl: null }
          : { list: list(['ada', 'bo'], 'p2'), socketUrl: null };
      },
    });
    await clock.advance(0);
    driver.loadMore();
    await clock.advance(0);
    driver.setFilter('friends');
    driver.setFilter('friends');
    await clock.advance(200);
    assert({
      given: 'two pages loaded, then the friends filter, set twice',
      should: 'read the friends once, one page only',
      actual: {
        asked,
        snapshot: {
          filter: driver.readSnapshot().filter,
          shown: driver.readSnapshot().list.people.map((row) => row.username),
        },
      },
      expected: {
        asked: ['all  -', 'all  p2', 'friends  -'],
        snapshot: { filter: 'friends', shown: ['ada', 'bo'] },
      },
    });
  });

  test('dispose closes the socket and stops every wait', async () => {
    const { clock, driver, reads, log, ring } = start({
      socketUrl: 'wss://rt.test/a',
    });
    ring('wss://rt.test/a', 'online_changed');
    driver.setQuery('ada');
    driver.dispose();
    await clock.advance(120_000);
    assert({
      given: 'a ring, a search and the tick all waiting',
      should: 'read nothing more and close the socket',
      actual: { reads: reads.length, log: log.slice(2) },
      expected: {
        reads: 0,
        log: ['stop wss://rt.test/a', 'dispose wss://rt.test/a'],
      },
    });
  });
});
