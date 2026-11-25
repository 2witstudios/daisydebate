import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isAppError } from '@daisy/errors';
import { z } from 'zod';
import { requireSameOriginRead } from './http';
import { inProcessFetch } from './in-process-fetch';
import { renderRead, renderReadHeaders } from './render-read';
setupRitewayBun();

const origin = 'https://daisy.invalid';
/** A page reached by a navigation from another site, as the browser sends it. */
const arrival = () =>
  new Headers({
    cookie: 'session=kept',
    'x-request-id': 'kept',
    origin: 'https://checkout.stripe.com',
    'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'navigate',
  });
const refusal = (headers: Headers) => {
  try {
    requireSameOriginRead(
      new Request(`${origin}/api/billing/settings`, { headers }),
      origin,
    );
    return null;
  } catch (error) {
    return isAppError(error) ? error.code : 'not an app error';
  }
};
/** A read-only route behind the same-origin read gate. */
const gated = async (request: Request) => {
  requireSameOriginRead(request, origin);
  return Response.json({
    plan: 'premium',
    session: request.headers.get('cookie'),
  });
};
const answer = z.strictObject({ plan: z.string(), session: z.string() });

test("a read the server makes for itself drops only the browser's Origin and Sec-Fetch-Site", () => {
  const navigation = arrival();
  const read = renderReadHeaders(navigation);
  assert({
    given: 'a page reached by a navigation from another site',
    should: 'drop those two headers and keep the session and every other one',
    actual: [...read.entries()].sort(),
    expected: [
      ['cookie', 'session=kept'],
      ['sec-fetch-mode', 'navigate'],
      ['x-request-id', 'kept'],
    ],
  });
  assert({
    given: 'the same-origin read gate, before and after',
    should: 'refuse the raw headers as AUTHORIZATION and admit the read',
    actual: [refusal(navigation), refusal(read)],
    expected: ['AUTHORIZATION', null],
  });
  assert({
    given: "the browser's headers after the read's were derived",
    should: 'be left as they arrived',
    actual: navigation.get('sec-fetch-site'),
    expected: 'cross-site',
  });
});

test('a render reached from another site still reads its own gated route', async () => {
  assert({
    given: 'a gated read-only route and a cross-site arrival with a session',
    should: "return the route's data, read with that session",
    actual: await renderRead(gated, '/api/billing/settings', answer, arrival()),
    expected: { plan: 'premium', session: 'session=kept' },
  });
  assert({
    given: 'a route that refuses, and one that answers off contract',
    should: 'return null for each',
    actual: [
      await renderRead(
        async () => new Response(null, { status: 403 }),
        '/x',
        answer,
        arrival(),
      ),
      await renderRead(
        async () => Response.json({ plan: 1 }),
        '/x',
        answer,
        arrival(),
      ),
    ],
    expected: [null, null],
  });
});

test('the in-process transport drops Sec-Fetch-Site for a read and keeps every header for a write', async () => {
  const seen: (readonly [string, string | null, string | null])[] = [];
  const handler = async (request: Request) => {
    seen.push([
      request.method,
      request.headers.get('origin'),
      request.headers.get('sec-fetch-site'),
    ]);
    return new Response(null);
  };
  const send = inProcessFetch(handler, arrival());
  await send('/api/rooms', {});
  await send('/api/rooms', { method: 'GET' });
  await send('/api/rooms', { method: 'HEAD' });
  await send('/api/rooms', { method: 'POST', body: '{}' });
  assert({
    given: 'reads and a write sent for the same browser request',
    should:
      "send each read without the browser's Sec-Fetch-Site, keep Origin on all, and send the write with both",
    actual: seen,
    expected: [
      ['GET', 'https://checkout.stripe.com', null],
      ['GET', 'https://checkout.stripe.com', null],
      ['HEAD', 'https://checkout.stripe.com', null],
      ['POST', 'https://checkout.stripe.com', 'cross-site'],
    ],
  });
});
