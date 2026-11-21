import { assert, setupRitewayBun, test } from 'riteway/bun';
import { interceptBrowserFetch } from './browser-request';

setupRitewayBun();

test('request observation keeps the original transport and releases it', async () => {
  const forwarded: unknown[] = [];
  const observed: unknown[] = [];
  const host: Pick<Window, 'fetch'> = {
    async fetch(input, init) {
      forwarded.push([this === host, input, init?.method]);
      return new Response(null, { status: 204 });
    },
  };
  const stop = interceptBrowserFetch(async (request, send) => {
    observed.push(request[0]);
    return send(...request);
  }, host);
  const response = await host.fetch('/refresh', { method: 'GET' });
  stop();
  await host.fetch('/later');
  assert({
    given: 'the same transport during and after a route’s observation',
    should:
      'preserve the receiver, the input and the response while observing only the active request',
    actual: [forwarded, observed, response.status],
    expected: [
      [
        [true, '/refresh', 'GET'],
        [true, '/later', undefined],
      ],
      ['/refresh'],
      204,
    ],
  });
});
