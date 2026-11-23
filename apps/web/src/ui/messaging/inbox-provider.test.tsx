import { virtualClock } from '@daisy/clock/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { mountBrowserClient } from '../test-support/browser-client.test-support';
import { virtualBrowserTime } from '../test-support/virtual-browser-time.test-support';
import type { MessagingInboxPageAnswer } from '../../features/messaging/inbox-view';
import type { useInbox } from './inbox-provider';
import type * as Client from './inbox-provider.test-support';

setupRitewayBun();

const channel = (n: number) => `c${String(n).padStart(23, '0')}`;
const entry = (n: number, activityAt = '2026-11-20T10:00:00.000Z') => ({
  channelId: channel(n),
  kind: 'conversation' as const,
  title: `Chat ${n}`,
  preview: null,
  activityAt,
  unread: false,
});
const cursor = (n: number) => `2026-11-20T10:00:00.000Z~${channel(n)}`;
const page = (
  entries: readonly ReturnType<typeof entry>[],
  nextAfter: string | null = null,
) =>
  Response.json(
    { version: 1, entries, nextAfter },
    { headers: { 'x-messaging-page-items': '50' } },
  );
type Inbox = ReturnType<typeof useInbox>;

/** The provider mounted in a private browser realm, its reads answered by the test. */
const mount = async (
  answer: (url: URL) => Response | Promise<Response>,
  seed: (MessagingInboxPageAnswer & { readonly now: string }) | null,
) => {
  const clock = virtualClock();
  const time = virtualBrowserTime(clock);
  const reads: string[] = [];
  const fetch = async (input: string) => {
    const url = new URL(input, 'https://daisy.test/');
    reads.push(`${url.pathname}${url.search}`);
    return answer(url);
  };
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./inbox-provider.test-support', import.meta.dir),
    { ...time.windowTimers, fetch, URL, URLSearchParams },
  );
  let inbox: Inbox | null = null;
  function Probe() {
    inbox = client.useInbox();
    return null;
  }
  const render = (current = seed) =>
    client.act(async () =>
      client.root.render(
        client.createElement(client.InboxProvider, {
          seed: current,
          actorId: channel(99),
          socketUrl: null,
          children: client.createElement(Probe),
        }),
      ),
    );
  await render();
  return {
    ...client,
    reads,
    render,
    advance: (ms: number) => client.act(() => clock.advance(ms)),
    inbox: () => {
      if (inbox === null) throw new Error('The probe has not rendered');
      return inbox;
    },
    close: async () => {
      await client.act(async () => client.root.unmount());
      await client.browser.happyDOM.abort();
    },
  };
};

const seeded = {
  entries: [entry(1)],
  nextAfter: cursor(1),
  now: '2026-11-20T10:05:00.000Z',
};

describe('inbox provider', () => {
  test('the layout seed is the first list', async () => {
    const withSeed = await mount(() => page([]), seeded);
    const without = await mount(() => page([]), null);
    try {
      assert({
        given: 'a seeded inbox and an unread one',
        should: 'show the seed, and an unavailable empty list without one',
        actual: [withSeed.inbox(), without.inbox()].map((inbox) => ({
          channels: inbox.entries.map((row) => row.channelId),
          nextAfter: inbox.nextAfter,
          now: inbox.now,
          available: inbox.available,
          searching: inbox.searching,
        })),
        expected: [
          {
            channels: [channel(1)],
            nextAfter: cursor(1),
            now: seeded.now,
            available: true,
            searching: false,
          },
          {
            channels: [],
            nextAfter: null,
            now: '',
            available: false,
            searching: false,
          },
        ],
      });
    } finally {
      await withSeed.close();
      await without.close();
    }
  });

  test('a search reads once typing pauses and applies its answer', async () => {
    const view = await mount(
      (url) =>
        url.searchParams.get('q') === 'ada' ? page([entry(2)]) : page([]),
      seeded,
    );
    try {
      await view.act(async () => view.inbox().setSearch('a'));
      await view.advance(100);
      await view.act(async () => view.inbox().setSearch(' ada '));
      await view.advance(249);
      const early = view.reads.length;
      await view.advance(1);
      assert({
        given: 'a search typed in two strokes',
        should: 'read once, 250 ms after the last, with the trimmed line',
        actual: {
          early,
          reads: view.reads,
          search: view.inbox().search,
          applied: view.inbox().appliedSearch,
          searching: view.inbox().searching,
          channels: view.inbox().entries.map((row) => row.channelId),
        },
        expected: {
          early: 0,
          reads: ['/api/messaging/inbox?q=ada'],
          search: ' ada ',
          applied: 'ada',
          searching: true,
          channels: [channel(2)],
        },
      });
    } finally {
      await view.close();
    }
  });

  test('clearing the search returns to the whole inbox', async () => {
    const view = await mount(
      (url) =>
        url.searchParams.has('q') ? page([entry(2)]) : page([entry(3)]),
      seeded,
    );
    try {
      await view.act(async () => view.inbox().setSearch('ada'));
      await view.advance(250);
      await view.act(async () => view.inbox().setSearch('  '));
      await view.advance(250);
      assert({
        given: 'a search, then a blank one',
        should: 'read the whole inbox and stop searching',
        actual: {
          reads: view.reads,
          applied: view.inbox().appliedSearch,
          searching: view.inbox().searching,
          channels: view.inbox().entries.map((row) => row.channelId),
        },
        expected: {
          reads: ['/api/messaging/inbox?q=ada', '/api/messaging/inbox'],
          applied: null,
          searching: false,
          channels: [channel(3)],
        },
      });
    } finally {
      await view.close();
    }
  });

  test('more appends the next page; a refused one says so', async () => {
    let refuse = false;
    const view = await mount(
      () => (refuse ? new Response(null, { status: 503 }) : page([entry(2)])),
      seeded,
    );
    try {
      let read = false;
      await view.act(async () => {
        read = await view.inbox().more(cursor(1));
      });
      refuse = true;
      let refused = true;
      await view.act(async () => {
        refused = await view.inbox().more(cursor(2));
      });
      assert({
        given: 'a next page that reads, then one that is refused',
        should: 'append the first, keep the list for the second',
        actual: {
          read,
          refused,
          reads: view.reads,
          channels: view.inbox().entries.map((row) => row.channelId),
          now: view.inbox().now,
        },
        expected: {
          read: true,
          refused: false,
          reads: [
            `/api/messaging/inbox?${new URLSearchParams({ after: cursor(1) })}`,
            `/api/messaging/inbox?${new URLSearchParams({ after: cursor(2) })}`,
          ],
          channels: [channel(1), channel(2)],
          now: seeded.now,
        },
      });
    } finally {
      await view.close();
    }
  });

  test('a new server render re-reads every loaded page after the ring wait', async () => {
    let round = 0;
    const view = await mount((url) => {
      if (url.searchParams.has('after'))
        return round === 0 ? page([entry(2)]) : page([entry(4)]);
      return round === 0
        ? page([entry(1)], cursor(1))
        : page([entry(3)], cursor(3));
    }, seeded);
    try {
      await view.act(async () => {
        await view.inbox().more(cursor(1));
      });
      round = 1;
      view.reads.length = 0;
      await view.render({ ...seeded });
      await view.advance(1499);
      const early = view.reads.length;
      await view.advance(1);
      assert({
        given: 'two loaded pages and a fresh layout render',
        should:
          'wait 750 ms a page, then replace the list with both pages read again',
        actual: {
          early,
          reads: view.reads.length,
          channels: view.inbox().entries.map((row) => row.channelId),
          measured: view.inbox().now !== seeded.now,
          available: view.inbox().available,
        },
        expected: {
          early: 0,
          reads: 2,
          channels: [channel(3), channel(4)],
          measured: true,
          available: true,
        },
      });
    } finally {
      await view.close();
    }
  });

  test('a failed refresh keeps what is shown', async () => {
    const view = await mount(() => new Response(null, { status: 500 }), seeded);
    try {
      await view.render({ ...seeded });
      await view.advance(750);
      assert({
        given: 'a ring whose read fails',
        should: 'keep the seed and its measured time',
        actual: {
          reads: view.reads.length,
          channels: view.inbox().entries.map((row) => row.channelId),
          now: view.inbox().now,
          available: view.inbox().available,
        },
        expected: {
          reads: 1,
          channels: [channel(1)],
          now: seeded.now,
          available: true,
        },
      });
    } finally {
      await view.close();
    }
  });

  test('an unread inbox becomes available once a refresh reads it', async () => {
    const view = await mount(() => page([entry(5)]), null);
    try {
      await view.render({ entries: [], nextAfter: null, now: '' });
      await view.advance(750);
      assert({
        given: 'an inbox the layout could not read, then a ring',
        should: 'show the read and become available',
        actual: {
          available: view.inbox().available,
          channels: view.inbox().entries.map((row) => row.channelId),
        },
        expected: { available: true, channels: [channel(5)] },
      });
    } finally {
      await view.close();
    }
  });
});
