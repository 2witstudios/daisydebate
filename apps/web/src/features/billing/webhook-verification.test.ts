import Stripe from 'stripe';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { verifyBillingWebhook } from './webhook-verification';

setupRitewayBun();

const secret = 'whsec_billing_signature_fixture';
const now = 1_790_000_000_000;
const event = {
  id: 'evt_billingFixture',
  object: 'event',
  type: 'customer.subscription.updated',
  livemode: false,
  created: 1,
  data: { object: { id: 'sub_fixture', customer: 'cus_fixture' } },
} as const;
const payload = JSON.stringify(event, null, 2);
const header = (body = payload, timestamp = now / 1000) =>
  Stripe.webhooks.generateTestHeaderStringAsync({
    payload: body,
    timestamp,
    secret,
  });
const verify = async (
  body = payload,
  signature: string | Promise<string> = header(),
  receivedAt = now,
) =>
  verifyBillingWebhook({
    body: new TextEncoder().encode(body),
    signature: await signature,
    receivedAt,
    secret,
    mode: 'test',
  });

test('a fresh delivery of an old event produces only a synchronization hint', async () => {
  assert({
    given: 'a correctly signed delivery whose event was created long ago',
    should:
      'authenticate delivery freshness without using event age as ordering or granting access',
    actual: await verify(),
    expected: {
      kind: 'accepted',
      hint: {
        eventId: event.id,
        customerId: 'cus_fixture',
        eventType: event.type,
      },
    },
  });
});

test('webhooks require exact signed bytes and a bounded delivery timestamp', async () => {
  assert({
    given:
      'tampered and reserialized bodies, stale and future delivery, wrong secret, malformed and duplicate timestamp',
    should: 'reject every one before emitting durable work',
    actual: await Promise.all([
      verify(payload.replace('cus_fixture', 'cus_attacker')),
      verify(JSON.stringify(event)),
      verify(payload, header(payload, now / 1000 - 301)),
      verify(payload, header(payload, now / 1000 + 301)),
      verify(
        payload,
        Stripe.webhooks.generateTestHeaderStringAsync({
          payload,
          timestamp: now / 1000,
          secret: 'whsec_wrong_fixture',
        }),
      ),
      verify(
        payload,
        (await header()).replace(`t=${now / 1000}`, `t=${now / 1000}junk`),
      ),
      verify(payload, `${await header()},t=${now / 1000}`),
    ]),
    expected: Array.from({ length: 7 }, () => ({ kind: 'rejected' })),
  });
});

test('verified payloads still validate mode and event shape', async () => {
  const invalid = [
    { ...event, livemode: true },
    { ...event, id: '' },
    { ...event, object: 'customer' },
    { ...event, data: { object: { customer: 'https://attacker.invalid' } } },
  ].map((value) => JSON.stringify(value));
  assert({
    given:
      'signed cross-mode, malformed identifier, wrong object or invalid customer payload',
    should: 'reject each instead of trusting SDK TypeScript types',
    actual: await Promise.all(
      invalid.map((body) => verify(body, header(body))),
    ),
    expected: invalid.map(() => ({ kind: 'rejected' })),
  });
});

test('unrelated signed events are ignored and deletion names its own customer', async () => {
  const bodies = [
    { ...event, type: 'payment_method.attached' },
    {
      ...event,
      type: 'customer.deleted',
      data: { object: { id: 'cus_fixture', object: 'customer', metadata: {} } },
    },
  ].map((value) => JSON.stringify(value));
  assert({
    given: 'an unrelated event and a customer deletion',
    should:
      'acknowledge the unrelated delivery and schedule deletion reconciliation by customer',
    actual: await Promise.all(bodies.map((body) => verify(body, header(body)))),
    expected: [
      { kind: 'ignored' },
      {
        kind: 'accepted',
        hint: {
          eventId: event.id,
          customerId: 'cus_fixture',
          eventType: 'customer.deleted',
        },
      },
    ],
  });
});

test('invalid time and oversized input are refused', async () => {
  assert({
    given: 'invalid evaluation time, oversized body and oversized header',
    should: 'reject before signature work without exposing input values',
    actual: await Promise.all([
      verify(payload, header(), Number.NaN),
      verify('x'.repeat(256 * 1024 + 1)),
      verify(payload, 'x'.repeat(4097)),
    ]),
    expected: [
      { kind: 'rejected' },
      { kind: 'rejected' },
      { kind: 'rejected' },
    ],
  });
});

test('customer deletion requires a Customer event object, not a deletion API response', async () => {
  const bodies = [
    { id: 'cus_fixture', deleted: true },
    { id: 'cus_fixture', object: 'invoice' },
    { id: 'in_fixture', object: 'customer' },
  ].map((object) =>
    JSON.stringify({ ...event, type: 'customer.deleted', data: { object } }),
  );
  assert({
    given:
      'signed deletion-response, wrong discriminator and wrong identifier payloads',
    should:
      'refuse each without treating an unrelated object as a billing customer',
    actual: await Promise.all(bodies.map((body) => verify(body, header(body)))),
    expected: [
      { kind: 'rejected' },
      { kind: 'rejected' },
      { kind: 'rejected' },
    ],
  });
});
