import Stripe from 'stripe';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { createBillingWebhook } from './webhook-handler';

setupRitewayBun();
const now = 1_790_000_000_000;
const config = {
  kind: 'stripe' as const,
  mode: 'test' as const,
  webhookSecret: 'whsec_handler_fixture',
  secretKey: 'sk_test_unused',
  premiumPriceId: 'price_fixture',
  portalConfigurationId: 'bpc_fixture',
};
const event = {
  id: 'evt_fixture',
  object: 'event',
  type: 'invoice.paid',
  livemode: false,
  data: { object: { customer: 'cus_fixture' } },
};
const body = JSON.stringify(event, null, 2);
const signature = () =>
  Stripe.webhooks.generateTestHeaderStringAsync({
    payload: body,
    secret: config.webhookSecret,
    timestamp: now / 1000,
  });
const request = async (payload = body) =>
  new Request('https://daisy.invalid/api/webhooks/stripe', {
    method: 'POST',
    body: payload,
    headers: { 'stripe-signature': await signature() },
  });
const base = {
  config,
  clock: fixedClock(new Date(now).toISOString()),
  deadline: () => new AbortController().signal,
  failed: () => {},
};

test('webhook success waits for durable receipt completion and transient failures ask Stripe to retry', async () => {
  const entered = Promise.withResolvers<void>(),
    finish = Promise.withResolvers<'recorded'>();
  const receipts: unknown[] = [];
  let answered = false;
  const handler = createBillingWebhook({
    ...base,
    receive: async (receipt) => {
      receipts.push(receipt);
      entered.resolve();
      return finish.promise;
    },
  });
  const pending = handler(await request()).then((response) => {
    answered = true;
    return response;
  });
  await entered.promise;
  assert({
    given: 'a verified event whose database transaction has not completed',
    should: 'retain HTTP acknowledgement until durability is known',
    actual: answered,
    expected: false,
  });
  finish.resolve('recorded');
  const response = await pending;
  let failures = 0;
  const failed = createBillingWebhook({
    ...base,
    receive: async () => {
      throw Error('private database details');
    },
    failed: () => {
      failures += 1;
    },
  });
  const retry = await failed(await request());
  assert({
    given: 'successful commit and a separate uncertain persistence result',
    should:
      'acknowledge only the former and return a bounded retry without private values',
    actual: [
      response.status,
      receipts,
      retry.status,
      retry.headers.get('retry-after'),
      await retry.text(),
      failures,
    ],
    expected: [
      204,
      [{ eventId: 'evt_fixture', customerId: 'cus_fixture', mode: 'test' }],
      503,
      '5',
      '',
      1,
    ],
  });
});

test('disabled, unsigned, tampered and oversized deliveries never reach receipt persistence', async () => {
  let writes = 0;
  const receive = async () => {
    writes += 1;
    return 'recorded' as const;
  };
  const handler = createBillingWebhook({ ...base, receive });
  const disabled = createBillingWebhook({
    ...base,
    config: { kind: 'disabled' },
    receive,
  });
  const statuses = [
    (await disabled(await request())).status,
    (
      await handler(
        new Request('https://daisy.invalid', { method: 'POST', body }),
      )
    ).status,
    (await handler(await request(body.replace('cus_fixture', 'cus_other'))))
      .status,
    (await handler(await request('x'.repeat(256 * 1024 + 1)))).status,
  ];
  assert({
    given: 'no-key configuration and invalid raw deliveries',
    should: 'refuse before any durable write',
    actual: [statuses, writes],
    expected: [[404, 400, 400, 400], 0],
  });
});

test('a body deadline cancels a stalled stream even when the peer never resolves cancellation', async () => {
  const controller = new AbortController(),
    entered = Promise.withResolvers<void>();
  let canceled = 0,
    writes = 0;
  const stream = new ReadableStream<Uint8Array>({
    start() {
      entered.resolve();
    },
    cancel() {
      canceled += 1;
      return new Promise<void>(() => {});
    },
  });
  const handler = createBillingWebhook({
    ...base,
    deadline: () => controller.signal,
    receive: async () => {
      writes += 1;
      return 'recorded';
    },
  });
  const pending = handler(
    new Request('https://daisy.invalid', {
      method: 'POST',
      body: stream,
      headers: { 'stripe-signature': await signature() },
    }),
  );
  await entered.promise;
  controller.abort();
  const response = await pending;
  assert({
    given: 'the injected read deadline expires on a never-ending body',
    should:
      'cancel once, return without waiting for peer cancellation and never persist it',
    actual: [response.status, canceled, writes],
    expected: [400, 1, 0],
  });
});
