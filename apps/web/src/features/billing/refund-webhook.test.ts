import Stripe from 'stripe';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { verifyBillingWebhook } from './webhook-verification';
import { createBillingWebhook } from './webhook-handler';

setupRitewayBun();
const now = 1_790_000_000_000;
const config = {
  kind: 'stripe' as const,
  mode: 'test' as const,
  webhookSecret: 'whsec_refund_fixture',
  secretKey: 'sk_test_unused',
  premiumPriceId: 'price_fixture',
  portalConfigurationId: 'bpc_fixture',
};
const refund = {
  object: 'refund',
  id: 're_original',
  charge: 'ch_original',
  customer: null,
  status: 'failed',
  metadata: { daisy_refund_action_id: 'a'.repeat(24) },
};
const event = (
  object: unknown = refund,
  type = 'refund.failed',
  livemode = false,
) =>
  JSON.stringify({
    id: 'evt_refund',
    object: 'event',
    type,
    livemode,
    data: { object },
  });
const signature = (body: string) =>
  Stripe.webhooks.generateTestHeaderStringAsync({
    payload: body,
    secret: config.webhookSecret,
    timestamp: now / 1000,
  });
const verify = async (body: string) =>
  verifyBillingWebhook({
    body: new TextEncoder().encode(body),
    signature: await signature(body),
    secret: config.webhookSecret,
    mode: 'test',
    receivedAt: now,
  });

test('refund events authenticate nullable-customer routing without accepting a webhook status as payment truth', async () => {
  const types = ['refund.created', 'refund.updated', 'refund.failed'] as const;
  const outcomes = await Promise.all(
    types.map((type) => verify(event(refund, type))),
  );
  assert({
    given:
      'signed refund events with a retained action but no ordinary customer object',
    should:
      'emit only owned-routing hints, excluding status and raw financial payload',
    actual: outcomes,
    expected: types.map((eventType) => ({
      kind: 'accepted' as const,
      hint: {
        eventId: 'evt_refund',
        eventType,
        refund: {
          id: refund.id,
          chargeId: refund.charge,
          customerId: null,
          actionId: refund.metadata.daisy_refund_action_id,
        },
      },
    })),
  });
  const invalid = [
    { ...refund, charge: 'ch_/invalid' },
    { ...refund, customer: 'cus_/invalid' },
    { ...refund, metadata: { daisy_refund_action_id: 'invalid' } },
    { ...refund, object: 'charge' },
  ];
  assert({
    given: 'malformed routing and wrong mode despite valid signatures',
    should: 'refuse before any database or vendor work',
    actual: await Promise.all([
      ...invalid.map((object) => verify(event(object))),
      verify(event(refund, 'refund.failed', true)),
    ]),
    expected: Array(5).fill({ kind: 'rejected' }),
  });
});

test('refund HTTP acknowledgement waits for retained-action receipt durability and never logs payload', async () => {
  const entered = Promise.withResolvers<void>(),
    complete = Promise.withResolvers<'closed'>();
  const calls: unknown[] = [];
  const handler = createBillingWebhook({
    config,
    clock: fixedClock(new Date(now).toISOString()),
    deadline: () => new AbortController().signal,
    failed: () => {},
    receive: async (receipt) => {
      calls.push(receipt);
      entered.resolve();
      return complete.promise;
    },
  });
  const body = event();
  let answered = false;
  const pending = handler(
    new Request('https://daisy.invalid/api/webhooks/stripe', {
      method: 'POST',
      body,
      headers: { 'stripe-signature': await signature(body) },
    }),
  ).then((response) => {
    answered = true;
    return response;
  });
  await entered.promise;
  assert({
    given: 'an owned refund hint whose receipt is uncommitted',
    should: 'wait for durability',
    actual: answered,
    expected: false,
  });
  complete.resolve('closed');
  assert({
    given: 'the committed closed-account receipt',
    should: 'acknowledge using only minimal routing',
    actual: [(await pending).status, calls],
    expected: [
      204,
      [
        {
          eventId: 'evt_refund',
          mode: 'test',
          refund: {
            id: refund.id,
            chargeId: refund.charge,
            customerId: null,
            actionId: refund.metadata.daisy_refund_action_id,
          },
        },
      ],
    ],
  });
});
