import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readServerConfig } from '@daisy/config';
import type { Logger } from '@daisy/logger';

setupRitewayBun();

// Seed process-local resources so handleOperation never builds real clients.
const silent: Logger = { log: () => {}, child: () => silent };
Reflect.set(globalThis, 'daisyResources', {
  config: readServerConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
    REDIS_URL: 'redis://localhost:6379',
    REDIS_NAMESPACE: 'test',
    PUBLIC_APP_URL: 'https://daisy.invalid',
    APP_VERSION: 'test',
    GIT_COMMIT: 'test',
  }),
  logger: silent,
  draining: false,
});
const { createConfirmHandlers } = await import('./confirm');

const token = 'a'.repeat(32);

/** Better Auth answering a verify: an absolute redirect on the public origin. */
const handlers = (location: string) =>
  createConfirmHandlers({
    auth: () => ({
      config: { PUBLIC_APP_URL: 'https://daisy.invalid' },
      handler: async () =>
        new Response(null, {
          status: 302,
          headers: { location, 'set-cookie': 'session=value; Path=/' },
        }),
    }),
  });

const post = (headers: Record<string, string>) =>
  // The request as Next sees it behind a TLS terminator: plain HTTP.
  new Request('http://internal.invalid/auth/confirm', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: new URLSearchParams({ token, callbackURL: '/ranked' }).toString(),
  });

describe('confirm submit behind TLS termination', () => {
  test('keeps the destination when the target is on the public origin', async () => {
    const response = await handlers(
      'https://daisy.invalid/ranked?tab=open',
    ).POST(post({ origin: 'https://daisy.invalid' }));
    assert({
      given:
        'an absolute HTTPS redirect from the auth handler for a request the app sees as HTTP',
      should:
        'redirect to the same path and query and carry the session cookie',
      actual: [
        response.status,
        response.headers.get('location'),
        response.headers.getSetCookie(),
      ],
      expected: [303, '/ranked?tab=open', ['session=value; Path=/']],
    });
  });

  test('still refuses a foreign target', async () => {
    const response = await handlers('https://evil.example/steal').POST(
      post({ origin: 'https://daisy.invalid' }),
    );
    assert({
      given: 'a redirect to another origin',
      should: 'fall back to the lobby',
      actual: [response.status, response.headers.get('location')],
      expected: [303, '/lobby'],
    });
  });

  test('accepts the null origin a no-referrer form sends from the same origin', async () => {
    const same = await handlers('/ranked').POST(
      post({ origin: 'null', 'sec-fetch-site': 'same-origin' }),
    );
    const cross = await handlers('/ranked').POST(
      post({ origin: 'null', 'sec-fetch-site': 'cross-site' }),
    );
    assert({
      given: 'Origin null from same-origin and cross-site senders',
      should: 'redirect the first and refuse the second with 403',
      actual: [same.status, cross.status],
      expected: [303, 403],
    });
  });
});
