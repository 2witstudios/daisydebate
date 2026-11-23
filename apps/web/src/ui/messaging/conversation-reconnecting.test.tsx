import { virtualClock } from '@daisy/clock/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { mountBrowserClient } from '../test-support/browser-client.test-support';
import { virtualBrowserTime } from '../test-support/virtual-browser-time.test-support';
import { accessibleWithin } from '../../test-support/rendered/accessible';
import { shellNavigationEvent } from '../layout/app-shell/shell-navigation';
import type * as Client from './conversation-reconnecting.test-support';
import type { ConversationRecoveryOrigin } from './conversation-recovery';

setupRitewayBun();

const requestA = 'a'.repeat(24);
const requestB = 'b'.repeat(24);
const requestC = 'c'.repeat(24);
const requestD = 'd'.repeat(24);

/**
 * The recovery owner mounted in a private browser realm on a virtual clock:
 * the router records refreshes, and the page's route reads are handed to
 * its Resource Timing observer by the test.
 */
const mount = async () => {
  const clock = virtualClock();
  const time = virtualBrowserTime(clock);
  const observers: ((entries: readonly object[]) => void)[] = [];
  class PerformanceObserver {
    constructor(
      private readonly report: (list: {
        getEntries: () => readonly object[];
      }) => void,
    ) {}
    observe() {
      observers.push((entries) => this.report({ getEntries: () => entries }));
    }
    disconnect() {}
  }
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync(
      './conversation-reconnecting.test-support',
      import.meta.dir,
    ),
    (browser) => ({
      ...time.windowTimers,
      PerformanceObserver,
      URL,
      URLSearchParams,
      Element: browser.Element,
      HTMLAnchorElement: browser.HTMLAnchorElement,
      HTMLFormElement: browser.HTMLFormElement,
      process: { env: { NODE_ENV: 'test' } },
    }),
  );
  const refreshes: string[] = [];
  const router = {
    bfcacheId: 'test',
    back: () => {},
    forward: () => {},
    refresh: () => refreshes.push(client.browser.location.href),
    push: () => {},
    replace: () => {},
    prefetch: () => {},
  };
  const render = (props: {
    readonly requestId: string;
    readonly retryAfterMs: number;
    readonly origin?: ConversationRecoveryOrigin;
  }) =>
    client.act(async () =>
      client.root.render(
        client.createElement(
          client.AppRouterContext,
          { value: router },
          client.createElement(client.ConversationReconnecting, {
            origin: 'page-read',
            ...props,
          }),
        ),
      ),
    );
  const advance = (ms: number) => client.act(() => clock.advance(ms));
  /** The page's own route read finishing, as Resource Timing records it. */
  const pageReadFinished = () =>
    client.act(async () => {
      const entry = {
        initiatorType: 'fetch',
        name: `${client.browser.location.origin}${client.browser.location.pathname}?_rsc=x`,
      };
      for (const observe of observers) observe([entry]);
    });
  const view = () => accessibleWithin(client.container as unknown as Element);
  /** Clicks a link the way a member does; the window keeps the realm in place. */
  const clickLink = (attributes: Readonly<Record<string, string>>) =>
    client.act(async () => {
      const link = client.browser.document.createElement('a');
      for (const [name, value] of Object.entries(attributes))
        link.setAttribute(name, value);
      client.browser.document.body.append(link);
      client.browser.addEventListener(
        'click',
        (event) => event.preventDefault(),
        { once: true },
      );
      link.click();
    });
  const dispatch = (target: 'document' | 'window', event: Event) =>
    client.act(async () => {
      (target === 'document'
        ? client.browser.document
        : client.browser
      ).dispatchEvent(event as never);
    });
  return {
    ...client,
    refreshes,
    render,
    advance,
    pageReadFinished,
    view,
    clickLink,
    dispatch,
    close: async () => {
      await client.act(async () => client.root.unmount());
      await client.browser.happyDOM.abort();
    },
  };
};

describe('conversation recovery', () => {
  test('a refused page waits its retry, then refreshes once', async () => {
    const page = await mount();
    try {
      await page.render({ requestId: requestA, retryAfterMs: 1000 });
      await page.advance(999);
      const early = page.refreshes.length;
      await page.advance(1);
      const late = page.refreshes.length;
      await page.advance(60_000);
      assert({
        given: 'a temporary refusal that asks for a one second wait',
        should: 'refresh at one second and not again on its own',
        actual: {
          early,
          late,
          after: page.refreshes.length,
          says: page.view().text('status'),
          retry: page.view().textContent().endsWith('Try again'),
        },
        expected: {
          early: 0,
          late: 1,
          after: 1,
          says: 'This conversation could not load.',
          retry: true,
        },
      });
    } finally {
      await page.close();
    }
  });

  test('each refused answer doubles the wait; the fourth gives up', async () => {
    const page = await mount();
    try {
      const at: number[] = [];
      let elapsed = 0;
      const until = async (count: number) => {
        while (page.refreshes.length < count && elapsed < 60_000) {
          await page.advance(100);
          elapsed += 100;
        }
        at.push(elapsed);
      };
      await page.render({ requestId: requestA, retryAfterMs: 1000 });
      await until(1);
      await page.pageReadFinished();
      await page.render({ requestId: requestB, retryAfterMs: 1000 });
      await until(2);
      await page.pageReadFinished();
      await page.render({ requestId: requestC, retryAfterMs: 1000 });
      await until(3);
      await page.pageReadFinished();
      const before = page.view().text('status');
      await page.render({ requestId: requestD, retryAfterMs: 1000 });
      await page.advance(60_000);
      assert({
        given: 'four refused answers in a row',
        should:
          'refresh after 1, 2 and 4 seconds, then say it is still unavailable',
        actual: {
          at,
          refreshes: page.refreshes.length,
          before,
          after: page.view().text('status'),
        },
        expected: {
          at: [1000, 3000, 7000],
          refreshes: 3,
          before: 'This conversation could not load.',
          after: 'This conversation is still unavailable. Try again.',
        },
      });
    } finally {
      await page.close();
    }
  });

  test('a page that answered stays answered', async () => {
    const page = await mount();
    try {
      await page.render({ requestId: requestA, retryAfterMs: 1000 });
      await page.render({ requestId: requestA, retryAfterMs: 1000 });
      await page.advance(1000);
      await page.render({ requestId: requestA, retryAfterMs: 1000 });
      await page.pageReadFinished();
      await page.advance(60_000);
      assert({
        given: 'the same refused answer rendered again',
        should: 'not count it twice',
        actual: page.refreshes.length,
        expected: 1,
      });
    } finally {
      await page.close();
    }
  });

  test('an action render during a held refresh waits for it to settle', async () => {
    const page = await mount();
    try {
      await page.render({ requestId: requestA, retryAfterMs: 1000 });
      await page.advance(1000);
      await page.render({
        requestId: requestB,
        retryAfterMs: 1000,
        origin: 'action-render',
      });
      await page.advance(10_000);
      const held = page.refreshes.length;
      await page.pageReadFinished();
      await page.advance(1999);
      const waiting = page.refreshes.length;
      await page.advance(1);
      assert({
        given: 'an action answer while the first refresh is still held',
        should:
          'buffer it, and wait its doubled retry only once the page read arrives',
        actual: { held, waiting, after: page.refreshes.length },
        expected: { held: 1, waiting: 1, after: 2 },
      });
    } finally {
      await page.close();
    }
  });

  test('an unrecorded page read settles after thirty seconds', async () => {
    const page = await mount();
    try {
      await page.render({ requestId: requestA, retryAfterMs: 1000 });
      await page.advance(1000);
      await page.render({
        requestId: requestB,
        retryAfterMs: 1000,
        origin: 'action-render',
      });
      await page.advance(29_999);
      const held = page.refreshes.length;
      await page.advance(1 + 2000);
      assert({
        given: 'a held refresh whose read Resource Timing never records',
        should: 'settle at its thirty second limit and go on',
        actual: { held, after: page.refreshes.length },
        expected: { held: 1, after: 2 },
      });
    } finally {
      await page.close();
    }
  });

  for (const [leaving, leave] of [
    [
      'a same-tab link',
      (page: Awaited<ReturnType<typeof mount>>) =>
        page.clickLink({ href: '/messages' }),
    ],
    [
      'the shell navigating',
      (page: Awaited<ReturnType<typeof mount>>) =>
        page.dispatch(
          'document',
          new page.browser.Event(shellNavigationEvent) as never,
        ),
    ],
    [
      'history going back',
      (page: Awaited<ReturnType<typeof mount>>) =>
        page.dispatch('window', new page.browser.Event('popstate') as never),
    ],
    [
      'the page being hidden',
      (page: Awaited<ReturnType<typeof mount>>) =>
        page.dispatch('window', new page.browser.Event('pagehide') as never),
    ],
  ] as const)
    test(`${leaving} ends the recovery`, async () => {
      const page = await mount();
      try {
        await page.render({ requestId: requestA, retryAfterMs: 1000 });
        await leave(page);
        await page.advance(60_000);
        assert({
          given: `${leaving} before the wait ends`,
          should: 'never refresh the page left behind',
          actual: page.refreshes.length,
          expected: 0,
        });
      } finally {
        await page.close();
      }
    });

  test('a new-tab link leaves the recovery running', async () => {
    const page = await mount();
    try {
      await page.render({ requestId: requestA, retryAfterMs: 1000 });
      await page.clickLink({ href: '/messages', target: '_blank' });
      await page.clickLink({ href: '/file', download: '' });
      await page.advance(1000);
      assert({
        given: 'a link that opens a new tab and a download',
        should: 'still refresh the page',
        actual: page.refreshes.length,
        expected: 1,
      });
    } finally {
      await page.close();
    }
  });

  test('a page whose address changed is not refreshed', async () => {
    const page = await mount();
    try {
      await page.render({ requestId: requestA, retryAfterMs: 1000 });
      page.browser.history.pushState(null, '', '/messages/other');
      await page.advance(1000);
      assert({
        given: 'the address moved during the wait without a navigation event',
        should: 'stop instead of refreshing a different page',
        actual: page.refreshes.length,
        expected: 0,
      });
    } finally {
      await page.close();
    }
  });
});
