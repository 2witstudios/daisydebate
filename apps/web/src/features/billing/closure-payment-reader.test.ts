import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { createClosurePaymentReader } from './closure-payment-reader';
import { observeClosurePayment } from './closure-payment';
import {
  owner,
  payment,
  charge,
  intent,
  facts,
} from './closure-payment.test-support';
setupRitewayBun();
const expanded = {
  ...payment,
  invoice: facts.invoice,
  payment: {
    type: 'payment_intent',
    payment_intent: { ...intent, latest_charge: charge },
  },
};
const request = { owner, paymentId: payment.id, closedAt: facts.closedAt };

test('payment reader makes one bounded linked read and preserves exact normalized allocation', async () => {
  const calls: string[] = [];
  const read = createClosurePaymentReader({
    mode: 'test',
    clock: fixedClock(facts.now),
    port: {
      payment: async (id) => {
        calls.push(id);
        return expanded;
      },
    },
  });
  const result = await read(request);
  assert({
    given: 'the server-owned invoice payment with its requested linked objects',
    should: 'normalize original financial facts through one transport request',
    actual: [result, calls],
    expected: [observeClosurePayment(facts), [payment.id]],
  });
});

test('invalid local identity and cross-mode requests make zero vendor calls', async () => {
  let calls = 0;
  const read = createClosurePaymentReader({
    mode: 'test',
    clock: fixedClock(facts.now),
    port: {
      payment: async () => {
        calls++;
        return expanded;
      },
    },
  });
  const invalid = [
    { ...request, owner: null },
    { ...request, closedAt: 'invalid' },
    { ...request, owner: { ...owner, mode: 'live' } },
    { ...request, paymentId: 'inpay_/invalid' },
    { ...request, owner: { ...owner, customerId: 'cus_/invalid' } },
  ];
  assert({
    given: 'invalid account mapping, resource ID or configured mode',
    should: 'retain unresolved work without following any reference',
    actual: [await Promise.all(invalid.map(read)), calls],
    expected: [invalid.map(() => ({ kind: 'unresolved' })), 0],
  });
});

test('missing/foreign expanded evidence and failed reads stay unresolved with no private error leakage', async () => {
  const responses = [
    null,
    { ...expanded, id: 'inpay_other' },
    payment,
    { ...expanded, invoice: { ...facts.invoice, customer: 'cus_other' } },
    {
      ...expanded,
      payment: {
        type: 'payment_intent',
        payment_intent: {
          ...intent,
          latest_charge: { ...charge, amount_captured: 999 },
        },
      },
    },
  ];
  const results = [];
  for (const value of responses)
    results.push(
      await createClosurePaymentReader({
        mode: 'test',
        clock: fixedClock(facts.now),
        port: { payment: async () => value },
      })(request),
    );
  results.push(
    await createClosurePaymentReader({
      mode: 'test',
      clock: fixedClock(facts.now),
      port: {
        payment: async () => {
          throw Error('private vendor response');
        },
      },
    })(request),
  );
  assert({
    given:
      'unavailable, mismatched or partial evidence and a lost vendor read reply',
    should:
      'report only unresolved status and never definite pre-closure settlement',
    actual: results,
    expected: Array(6).fill({ kind: 'unresolved' }),
  });
});
