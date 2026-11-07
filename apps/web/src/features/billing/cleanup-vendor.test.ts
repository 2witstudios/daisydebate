import { assert, setupRitewayBun, test } from 'riteway/bun';
import Stripe from 'stripe';
import { stripeCleanupPort } from './cleanup-vendor';
setupRitewayBun();

test('the actual pinned SDK bounds cleanup pages and refuses automatic financial changes on cancellation', async () => {
  const calls: unknown[] = [];
  const transport = Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const url = new URL(String(input));
      calls.push({
        method: init?.method ?? 'GET',
        path: url.pathname,
        parameters: Object.fromEntries(new URLSearchParams(url.search)),
        body: String(init?.body ?? ''),
        version: new Headers(init?.headers).get('Stripe-Version'),
      });
      return Response.json({ object: 'list', data: [], has_more: false });
    },
    { preconnect() {} },
  );
  const stripe = new Stripe('sk_test_fixture', {
    httpClient: Stripe.createFetchHttpClient(transport),
    telemetry: false,
  });
  const port = stripeCleanupPort(stripe);
  await port.subscriptions({ customer: 'cus_owned', afterId: null });
  await port.invoices({ customer: 'cus_owned', afterId: 'in_prior' });
  await port.cancelSubscription('sub_owned');
  await port.deleteCustomer('cus_owned');
  assert({
    given:
      'one source-bound cleanup call per request through the installed SDK and a controlled HTTP response',
    should:
      'use exact owned pagination without status filtering invoices or creating final invoices/prorations',
    actual: calls,
    expected: [
      {
        method: 'GET',
        path: '/v1/subscriptions',
        parameters: { customer: 'cus_owned', limit: '20', status: 'all' },
        body: '',
        version: '2026-10-28.endive',
      },
      {
        method: 'GET',
        path: '/v1/invoices',
        parameters: {
          customer: 'cus_owned',
          limit: '20',
          starting_after: 'in_prior',
        },
        body: '',
        version: '2026-10-28.endive',
      },
      {
        method: 'DELETE',
        path: '/v1/subscriptions/sub_owned',
        parameters: { invoice_now: 'false', prorate: 'false' },
        body: '',
        version: '2026-10-28.endive',
      },
      {
        method: 'DELETE',
        path: '/v1/customers/cus_owned',
        parameters: {},
        body: '',
        version: '2026-10-28.endive',
      },
    ],
  });
});

test('a failed cleanup SDK response is one uncertain attempt without automatic retries', async () => {
  let calls = 0;
  const transport = Object.assign(
    async () => {
      calls++;
      return Response.json(
        { error: { type: 'api_error', message: 'Controlled failure' } },
        { status: 500 },
      );
    },
    { preconnect() {} },
  );
  const port = stripeCleanupPort(
    new Stripe('sk_test_fixture', {
      httpClient: Stripe.createFetchHttpClient(transport),
      telemetry: false,
    }),
  );
  let unknown = false;
  try {
    await port.cancelSubscription('sub_owned');
  } catch {
    unknown = true;
  }
  assert({
    given: 'one failed cancellation response from controlled SDK transport',
    should:
      'leave reconciliation to current durable authority instead of adding hidden writes or retries',
    actual: [unknown, calls],
    expected: [true, 1],
  });
});
