import { virtualClock } from '@daisy/clock/testing';
import type { PeopleList, Person } from '@daisy/protocol/people-list';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { mountBrowserClient } from '../test-support/browser-client.test-support';
import { virtualBrowserTime } from '../test-support/virtual-browser-time.test-support';
import type { usePeople } from './people-provider';
import type * as Client from './people-provider.test-support';

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
): PeopleList => ({
  version: 1,
  people: names.map(person),
  nextCursor,
  counts: { everyone: names.length, friends: 0, online: names.length },
  self: 'online',
});
type People = ReturnType<typeof usePeople>;
type Answer = (url: URL) => PeopleList | Promise<PeopleList> | null;

/** The provider in a private browser realm on a virtual clock, its reads answered by the test. */
const mount = async (answer: Answer, initial = list(['ada'])) => {
  const clock = virtualClock();
  const time = virtualBrowserTime(clock);
  const reads: string[] = [];
  const fetch = async (input: string) => {
    const url = new URL(input, 'https://daisy.test/');
    reads.push(`${url.pathname}${url.search}`);
    const body = await answer(url);
    return body === null
      ? new Response(null, { status: 503 })
      : Response.json(body);
  };
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./people-provider.test-support', import.meta.dir),
    {
      ...time.windowTimers,
      fetch,
      URL,
      URLSearchParams,
      performance: { now: () => clock.nowMs() },
      crypto: {
        getRandomValues: (values: Uint32Array) => values.fill(0),
      },
    },
  );
  let people: People | null = null;
  function Probe() {
    people = client.usePeople();
    return null;
  }
  await client.act(async () =>
    client.root.render(
      client.createElement(client.PeopleProvider, {
        initialList: initial,
        socketUrl: null,
        children: client.createElement(Probe),
      }),
    ),
  );
  return {
    ...client,
    reads,
    advance: (ms: number) => client.act(() => clock.advance(ms)),
    people: () => {
      if (people === null) throw new Error('The probe has not rendered');
      return people;
    },
    names: () => (people?.list.people ?? []).map((row) => row.username),
    close: async () => {
      await client.act(async () => client.root.unmount());
      await client.browser.happyDOM.abort();
    },
  };
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('people provider', () => {
  test('without a socket it reads at once, then every thirty seconds', async () => {
    const view = await mount(() => list(['ada', 'bo']));
    try {
      const first = [...view.reads];
      const shown = view.names();
      await view.advance(29_999);
      const before = view.reads.length;
      await view.advance(1);
      assert({
        given: 'a page with no realtime socket',
        should: 'read the list on mount, show it, and read again at 30 s',
        actual: { first, shown, before, after: view.reads.length },
        expected: {
          first: ['/api/people?filter=all'],
          shown: ['ada', 'bo'],
          before: 1,
          after: 2,
        },
      });
    } finally {
      await view.close();
    }
  });

  test('a filter or search reads once typing pauses', async () => {
    const view = await mount((url) =>
      url.searchParams.get('q') === 'bo' ? list(['bo']) : list(['ada']),
    );
    try {
      view.reads.length = 0;
      await view.act(async () => view.people().setFilter('friends'));
      await view.advance(100);
      await view.act(async () => view.people().setQuery('b'));
      await view.advance(100);
      await view.act(async () => view.people().setQuery(' bo '));
      await view.advance(199);
      const early = view.reads.length;
      await view.advance(1);
      assert({
        given: 'a filter and two keystrokes 100 ms apart',
        should: 'read once, 200 ms after the last, with the trimmed search',
        actual: {
          early,
          reads: view.reads,
          filter: view.people().filter,
          query: view.people().query,
          shown: view.names(),
        },
        expected: {
          early: 0,
          reads: ['/api/people?filter=friends&q=bo'],
          filter: 'friends',
          query: ' bo ',
          shown: ['bo'],
        },
      });
    } finally {
      await view.close();
    }
  });

  test('an answer to an older question never lands', async () => {
    const slow = deferred<PeopleList>();
    let calls = 0;
    const view = await mount((url) => {
      calls += 1;
      if (calls === 2) return slow.promise;
      return url.searchParams.get('filter') === 'friends'
        ? list(['friend'])
        : list(['ada']);
    });
    try {
      await view.act(async () => view.people().refresh());
      await view.act(async () => view.people().setFilter('friends'));
      await view.advance(200);
      await view.act(async () => slow.resolve(list(['stale'])));
      await view.advance(0);
      assert({
        given: 'a slow read of everyone, then a read of friends',
        should: 'show the friends and drop the stale answer',
        actual: view.names(),
        expected: ['friend'],
      });
    } finally {
      await view.close();
    }
  });

  test('loading more merges the next page and a re-read walks both', async () => {
    const view = await mount((url) =>
      url.searchParams.get('cursor') === 'p2'
        ? list(['cy'])
        : list(['ada', 'bo'], 'p2'),
    );
    try {
      await view.act(async () => view.people().loadMore());
      const merged = view.names();
      view.reads.length = 0;
      await view.act(async () => view.people().refresh());
      assert({
        given: 'a second page loaded, then a refresh',
        should: 'show both pages and re-read both',
        actual: { merged, reads: view.reads, after: view.names() },
        expected: {
          merged: ['ada', 'bo', 'cy'],
          reads: ['/api/people?filter=all', '/api/people?filter=all&cursor=p2'],
          after: ['ada', 'bo', 'cy'],
        },
      });
    } finally {
      await view.close();
    }
  });

  test('a refresh during a read asks once more after it', async () => {
    const slow = deferred<PeopleList>();
    let calls = 0;
    const view = await mount(() => {
      calls += 1;
      return calls === 2 ? slow.promise : list([`v${calls}`]);
    });
    try {
      await view.act(async () => view.people().refresh());
      await view.act(async () => view.people().refresh());
      await view.act(async () => view.people().refresh());
      const during = calls;
      await view.act(async () => slow.resolve(list(['v2'])));
      await view.advance(0);
      assert({
        given: 'three refreshes while one read is on its way',
        should: 'read one more time after it, and show that answer',
        actual: { during, calls, shown: view.names() },
        expected: { during: 2, calls: 3, shown: ['v3'] },
      });
    } finally {
      await view.close();
    }
  });

  test('a failed page keeps the list', async () => {
    let fail = false;
    const view = await mount(() => (fail ? null : list(['ada'])));
    try {
      fail = true;
      await view.act(async () => view.people().refresh());
      await view.act(async () => view.people().loadMore());
      assert({
        given: 'a refused read',
        should: 'keep what is shown',
        actual: view.names(),
        expected: ['ada'],
      });
    } finally {
      await view.close();
    }
  });
});
