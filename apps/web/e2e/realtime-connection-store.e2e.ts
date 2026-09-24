import { test, expect } from '@playwright/test';
import { resolveE2EPorts } from '../playwright.config';
import { buildRealtimeHarnessScript } from './support/realtime-harness';

/**
 * RT-2.6a's browser proof: the real `createBrowserConnectionStore` (bundled
 * from source, not reimplemented) driven in a real browser against the real
 * `apps/realtime` scaffold booted by this config's `webServer`. Ticket
 * consumption is RT-2.4b, so every `hello` here is rejected 4001
 * auth_failed today (apps/realtime/src/handlers/hello.ts) — this proves the
 * connect and close-code reactions, not delivery. `POST /api/realtime/ticket`
 * (RT-2.4a) is a parallel, unmerged leaf, so `window.fetch`'s answer for it
 * is stubbed here — "stub the fetch in tests" applies to this browser suite
 * exactly as it does to the unit suite.
 */
const realtimePort = resolveE2EPorts(process.env).realtime;
const socketUrl = `ws://127.0.0.1:${realtimePort}/ws`;
// The production web app sets a strict `connect-src 'self'` CSP (ADR 0024),
// which correctly blocks a cross-origin WebSocket from that origin. Loading
// the harness from the realtime server's own origin instead (it sets no
// CSP) proves the store against the real scaffold without weakening the
// app's production security posture for this test.
const realtimeOrigin = `http://127.0.0.1:${realtimePort}`;

function stubTicketFetchAndCountingSocket() {
  const realFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/api/realtime/ticket')) {
      return Promise.resolve(
        new Response(JSON.stringify({ ticket: 'a'.repeat(43) }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return realFetch(input, init);
  }) as typeof window.fetch;

  const sockets: WebSocket[] = [];
  class CountingSocket extends WebSocket {
    constructor(target: string | URL) {
      super(target);
      sockets.push(this);
      (window as unknown as { __socketCount: number }).__socketCount =
        sockets.length;
    }
  }
  (window as unknown as { WebSocket: typeof WebSocket }).WebSocket =
    CountingSocket;
}

test('opens exactly one socket per tab even when many components mount, and reacts to the real 4001 close by reconnecting once', async ({
  page,
}) => {
  const harnessScript = buildRealtimeHarnessScript();
  await page.goto(realtimeOrigin + '/health/live');
  await page.addScriptTag({ content: harnessScript });
  await page.evaluate(stubTicketFetchAndCountingSocket);

  await page.evaluate((url) => {
    const store = window.__daisyRealtimeHarness(url);
    (window as unknown as { __rtStore: unknown }).__rtStore = store;

    // Many components mounting in one render: three concurrent connect()
    // calls before any socket has had a chance to open.
    store.connect();
    store.connect();
    store.connect();
  }, socketUrl);

  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __socketCount?: number }).__socketCount,
      ),
    )
    .toBe(1);

  // A visibility flip while connecting/backing off must not itself spawn an
  // extra socket outside the store's own single-flight schedule.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(
    await page.evaluate(
      () => (window as unknown as { __socketCount?: number }).__socketCount,
    ),
  ).toBe(1);

  // The real scaffold rejects every hello with 4001 auth_failed today
  // (ticket consumption is RT-2.4b). The store's documented reaction is to
  // fetch a fresh ticket and reconnect: exactly one more socket appears.
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { __socketCount?: number }).__socketCount,
        ),
      { timeout: 15_000 },
    )
    .toBe(2);

  const state = await page.evaluate(() =>
    (
      window as unknown as {
        __rtStore: {
          getState(): { generation: number; terminal: string | null };
        };
      }
    ).__rtStore.getState(),
  );
  expect(state.generation).toBe(2);
  expect(state.terminal).toBeNull();
});

test('negative control: a store never told to connect opens no socket against the real scaffold', async ({
  page,
}) => {
  const harnessScript = buildRealtimeHarnessScript();
  await page.goto(realtimeOrigin + '/health/live');
  await page.addScriptTag({ content: harnessScript });
  await page.evaluate(stubTicketFetchAndCountingSocket);

  const socketCount = await page.evaluate((url) => {
    window.__daisyRealtimeHarness(url);
    // No connect() call.
    return (window as unknown as { __socketCount?: number }).__socketCount ?? 0;
  }, socketUrl);

  expect(socketCount).toBe(0);
});
