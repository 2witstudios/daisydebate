import { assert, setupRitewayBun, test } from 'riteway/bun';
import { noopErrorReporter } from '@daisy/observability';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createBillingNativeHandlers } from './native-handlers';
setupRitewayBun();
const origin = 'https://daisy.test';
const principal = { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) };
const post = (body = '', from = origin, query = '') =>
  new Request(`${origin}/api/billing/checkout${query}`, {
    method: 'POST',
    headers: {
      origin: from,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
const setup = () => {
  const called: unknown[] = [];
  const boundary = {
    logger: silentLogger,
    reporter: noopErrorReporter,
    origin: () => origin,
    identify: async () => ({ state: 'member', principal }) as never,
    limiter: () =>
      ({
        consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
      }) as never,
  };
  const handlers = createBillingNativeHandlers({
    boundary,
    checkout: async (subject) => {
      called.push(subject);
      return {
        kind: 'redirect',
        url: 'https://checkout.stripe.com/c/pay/cs_test_owned',
      };
    },
    portal: async () => ({ kind: 'unavailable' }),
  });
  return { handlers, called };
};
test('a native Checkout form returns a no-store 303 to validated hosted payment', async () => {
  const { handlers, called } = setup();
  const r = await handlers.checkout(post());
  assert({
    given: 'a plain same-origin form without JavaScript',
    should: 'use authenticated identity and navigate by POST/redirect/GET',
    actual: [
      r.status,
      r.headers.get('location'),
      r.headers.get('cache-control'),
      r.headers.get('referrer-policy'),
      called,
    ],
    expected: [
      303,
      'https://checkout.stripe.com/c/pay/cs_test_owned',
      'no-store',
      'no-referrer',
      [principal],
    ],
  });
});
test('forged form authority and cross-origin requests never call Checkout', async () => {
  const requests = [
    post('customer=cus_foreign'),
    post('price=price_foreign'),
    post('quantity=2'),
    post('return_url=https%3A%2F%2Fevil.example'),
    post('', 'https://evil.example'),
    post('', origin, '?purchase=forged'),
  ];
  const results = await Promise.all(
    requests.map(async (request) => {
      const { handlers, called } = setup();
      const response = await handlers.checkout(request);
      return [response.status, called.length];
    }),
  );
  assert({
    given: 'untrusted offer, owner, redirect or origin claims',
    should: 'refuse before vendor work',
    actual: results,
    expected: [
      [400, 0],
      [400, 0],
      [400, 0],
      [400, 0],
      [403, 0],
      [400, 0],
    ],
  });
});
