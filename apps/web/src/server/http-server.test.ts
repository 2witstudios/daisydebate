import type { AddressInfo } from 'node:net';
import type { Logger } from '@daisy/logger';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createHttpServer } from './http-server';

setupRitewayBun();

const authEnv = {
  NODE_ENV: 'test',
  BETTER_AUTH_SECRET:
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  PUBLIC_APP_URL: 'http://localhost:3000',
  RESEND_API_KEY: 're_test_000000000000000000000000',
  AUTH_EMAIL_FROM: 'Daisy <no-reply@daisy.example.com>',
};
const logger: Logger = { log: () => undefined, child: () => logger };

// The server start.ts runs, on a real loopback socket, with a stand-in for
// Next's request handler that records the identity the app would see.
async function serve(env: Record<string, string>) {
  const resources = { draining: false, logger };
  const seen: Array<string | string[] | undefined> = [];
  const server = createHttpServer({
    env: { ...authEnv, ...env },
    resources,
    handle: async (request, response) => {
      seen.push(request.headers['x-daisy-client-ip']);
      response.end('ok');
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const get = (headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}/`, { headers }).then(async (response) => ({
      status: response.status,
      body: await response.text(),
    }));
  const close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return { resources, seen, get, close };
}

describe('production http server composition', () => {
  test('stamps identity through the configured trusted proxies', async () => {
    const { seen, get, close } = await serve({
      AUTH_TRUSTED_PROXIES: '127.0.0.1',
    });
    const forged = await get({
      'x-daisy-client-ip': '1.1.1.1',
      'x-forwarded-for': '6.6.6.6, 198.51.100.7',
    });
    await close();
    assert({
      given:
        'AUTH_TRUSTED_PROXIES naming the loopback peer and a request forging x-daisy-client-ip and a left-most forwarded hop',
      should:
        'hand the app the right-most untrusted hop, never a caller value or the proxy',
      actual: { forged, seen },
      expected: { forged: { status: 200, body: 'ok' }, seen: ['198.51.100.7'] },
    });
  });

  test('without trusted proxies the socket peer is the identity', async () => {
    const { seen, get, close } = await serve({});
    await get({
      'x-daisy-client-ip': '1.1.1.1',
      'x-forwarded-for': '198.51.100.7',
    });
    await close();
    assert({
      given: 'no AUTH_TRUSTED_PROXIES and forged identity headers',
      should: 'hand the app the socket peer',
      actual: seen,
      expected: ['127.0.0.1'],
    });
  });

  test('draining answers 503 without reaching the app', async () => {
    const { resources, seen, get, close } = await serve({});
    const before = await get();
    resources.draining = true;
    const during = await get();
    await close();
    assert({
      given: 'the shared resources flipping to draining between two requests',
      should: 'serve the first and refuse the second with 503 before the app',
      actual: { before: before.status, during: during.status, seen },
      expected: { before: 200, during: 503, seen: ['127.0.0.1'] },
    });
  });

  test('refuses to build without valid auth configuration', () => {
    let message = '';
    try {
      createHttpServer({
        env: { ...authEnv, BETTER_AUTH_SECRET: 'too-short' },
        resources: { draining: false, logger },
        handle: async () => undefined,
      });
    } catch (error) {
      message = String(error);
    }
    assert({
      given: 'an auth secret that fails validation',
      should: 'throw naming the field, not its value',
      actual: {
        names: message.includes('BETTER_AUTH_SECRET'),
        leaks: message.includes('too-short'),
      },
      expected: { names: true, leaks: false },
    });
  });
});
