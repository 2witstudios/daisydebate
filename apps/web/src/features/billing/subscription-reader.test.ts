import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  readSubscriptionObservation,
  type SubscriptionReadPort,
} from './subscription-reader';
import {
  identity,
  subscription,
  invoice,
} from './subscription-observation.test-support';
setupRitewayBun();
const port: SubscriptionReadPort = {
  subscription: async () => subscription,
  invoice: async () => invoice,
  latestPaidInvoice: async () => ({
    object: 'list',
    has_more: true,
    data: [invoice],
  }),
};
test('subscription reads use at most three bounded calls and never trust a webhook body for access', async () => {
  const calls: string[] = [];
  const result = await readSubscriptionObservation(
    {
      subscription: async (id) => {
        calls.push(`subscription:${id}`);
        return subscription;
      },
      invoice: async (id) => {
        calls.push(`invoice:${id}`);
        return invoice;
      },
      latestPaidInvoice: async (id, customer) => {
        calls.push(`paid:${id}:${customer}`);
        return port.latestPaidInvoice(id, customer);
      },
    },
    identity,
  );
  assert({
    given: 'a stored mapping and current vendor responses',
    should: 'read current state plus exact invoice and newest paid proof only',
    actual: { calls, outcome: result.kind },
    expected: {
      calls: [
        'subscription:sub_fixture',
        'invoice:in_current',
        'paid:sub_fixture:cus_fixture',
      ],
      outcome: 'observed',
    },
  });
});
test('transport loss or a malformed vendor list cannot be converted into unpaid access', async () => {
  const fail = async () => {
    throw Error('raw secret-bearing vendor error');
  };
  const cases: SubscriptionReadPort[] = [
    { ...port, subscription: fail },
    { ...port, invoice: fail },
    { ...port, latestPaidInvoice: fail },
    {
      ...port,
      latestPaidInvoice: async () => ({
        object: 'list',
        data: [invoice, invoice],
        has_more: false,
      }),
    },
  ];
  assert({
    given:
      'failure at each network boundary and an oversized latest-paid result',
    should:
      'report retry/refusal without leaking exceptions or fabricating a settlement',
    actual: await Promise.all(
      cases.map((value) => readSubscriptionObservation(value, identity)),
    ),
    expected: [
      { kind: 'retry' },
      { kind: 'retry' },
      { kind: 'retry' },
      { kind: 'refuse' },
    ],
  });
});
test('forged identity or subscription references stop before dependent reads', async () => {
  let dependentReads = 0;
  const guarded: SubscriptionReadPort = {
    ...port,
    subscription: async () => ({ ...subscription, customer: 'cus_other' }),
    invoice: async () => {
      dependentReads++;
      return invoice;
    },
    latestPaidInvoice: async () => {
      dependentReads++;
      return { object: 'list', has_more: false, data: [] };
    },
  };
  assert({
    given: 'a mismatched mapping and a malformed caller identity',
    should: 'refuse before issuing invoice reads',
    actual: [
      await readSubscriptionObservation(guarded, identity),
      await readSubscriptionObservation(guarded, {
        ...identity,
        vendorSubscriptionId: '../../bad',
      }),
      dependentReads,
    ],
    expected: [{ kind: 'refuse' }, { kind: 'refuse' }, 0],
  });
});
test('no latest invoice remains an honest nonpayment observation rather than a missing-response success', async () => {
  let invoiceReads = 0;
  const result = await readSubscriptionObservation(
    {
      ...port,
      subscription: async () => ({
        ...subscription,
        status: 'incomplete',
        latest_invoice: null,
      }),
      invoice: async () => {
        invoiceReads++;
        return invoice;
      },
      latestPaidInvoice: async () => ({
        object: 'list',
        has_more: false,
        data: [],
      }),
    },
    identity,
  );
  assert({
    given: 'an initial subscription with no invoice or payment',
    should: 'record incomplete/unpaid and make no invoice-by-id request',
    actual: {
      invoiceReads,
      evidence: result.kind === 'observed' ? result.evidence : result,
    },
    expected: {
      invoiceReads: 0,
      evidence: { lifecycle: 'incomplete', settlement: { kind: 'unpaid' } },
    },
  });
});
