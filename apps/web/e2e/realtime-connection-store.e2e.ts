import { expect, test } from './support/fixtures';
import type { Page } from '@playwright/test';
import { resolveE2EPorts } from '../playwright.config';
import { buildRealtimeHarnessScript } from './support/realtime-harness';

/**
 * Browser close-reaction control against the actual realtime server. The
 * ticket response is deliberately syntactically valid but never issued to
 * Redis, so actual consumption refuses each hello with 4001. Authenticated
 * delivery is exercised separately by the registered native TLS profile.
 */
const realtimePort = resolveE2EPorts(process.env).realtime;
const socketUrl = `ws://127.0.0.1:${realtimePort}/ws`;
// The production web app sets a strict `connect-src 'self'` CSP (ADR 0024),
// which correctly blocks a cross-origin WebSocket from that origin. Loading
// the harness from the realtime server's own origin instead (it sets no
// CSP) proves the store against the real scaffold without weakening the
// app's production security posture for this test.
const realtimeOrigin = `http://127.0.0.1:${realtimePort}`;

function stubTicketFetchAndCountingSocket(socketUrl: string) {
  const realFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/api/realtime/ticket')) {
      return Promise.resolve(
        new Response(JSON.stringify({ ticket: 'a'.repeat(43), socketUrl }), {
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

async function prepareCloseControl(page: Page) {
  await page.goto(realtimeOrigin + '/health/live');
  await page.addScriptTag({ content: buildRealtimeHarnessScript() });
  await page.evaluate(stubTicketFetchAndCountingSocket, socketUrl);
}

test.beforeEach(async ({ page }) => {
  await prepareCloseControl(page);
});

test('opens exactly one socket per tab even when many components mount, and the real 4001 close reaction reaches terminal signed-out after three tries', async ({
  page,
}) => {
  // The three connect() calls and the count read happen inside one
  // page.evaluate: createSocket runs synchronously inside connect(), so the
  // count is exactly 1 here, before any event (including the jittered
  // reconnect that follows the real 4001 close below) can run. Polling for
  // this count separately raced that reconnect: the whole test can finish
  // in under a second, so a poll's first read can already see socket 3.
  const socketCountAfterMount = await page.evaluate((url) => {
    const store = window.__daisyRealtimeHarness(url);
    (window as unknown as { __rtStore: unknown }).__rtStore = store;

    // Many components mounting in one render: three concurrent connect()
    // calls before any socket has had a chance to open.
    store.connect();
    store.connect();
    store.connect();

    return (window as unknown as { __socketCount?: number }).__socketCount;
  }, socketUrl);
  expect(socketCountAfterMount).toBe(1);

  // Actual consumption refuses the deliberately unissued ticket with 4001.
  // The store's documented reaction is to
  // fetch a fresh ticket and reconnect, and to stop after 3 consecutive
  // failures with terminal signed-out (ADR 0031 §8). Waiting for that
  // terminal state, rather than asserting an exact socket count mid-flight,
  // is what makes this deterministic: the backoff between attempts is
  // jittered, so a poll for "count === 2" can race the third attempt.
  const getState = () =>
    page.evaluate(() =>
      (
        window as unknown as {
          __rtStore: {
            getState(): { generation: number; terminal: string | null };
          };
        }
      ).__rtStore.getState(),
    );

  await expect
    .poll(async () => (await getState()).terminal, { timeout: 20_000 })
    .toBe('signed-out');

  const [state, socketCount] = await Promise.all([
    getState(),
    page.evaluate(
      () => (window as unknown as { __socketCount?: number }).__socketCount,
    ),
  ]);
  expect(state.generation).toBe(3);
  expect(socketCount).toBe(3);
});

test('negative control: a store never told to connect opens no socket against the real scaffold', async ({
  page,
}) => {
  const socketCount = await page.evaluate((url) => {
    window.__daisyRealtimeHarness(url);
    // No connect() call.
    return (window as unknown as { __socketCount?: number }).__socketCount ?? 0;
  }, socketUrl);

  expect(socketCount).toBe(0);
});
