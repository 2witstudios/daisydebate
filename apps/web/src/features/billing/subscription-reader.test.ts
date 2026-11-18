import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  readClubSubscriptionObservation,
  readSubscriptionObservation,
  type SubscriptionReadPort,
} from './subscription-reader';
import {
  identity,
  subscription,
  invoice,
} from './subscription-observation.test-support';
import {
  clubSubscription,
  renewal,
} from './club-subscription-observation.test-support';
setupRitewayBun();
const port: SubscriptionReadPort = {
  subscription: async () => subscription,
  invoice: async () => invoice,
  latestPaidInvoice: async () => ({
    object: 'list',
    has_more: true,
    data: [invoice],
  }),
  paidInvoices: async () => ({ object: 'list', has_more: false, data: [] }),
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
      paidInvoices: port.paidInvoices,
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

test('a Club read follows its own subscription and a bounded page of paid invoices', async () => {
  const calls: string[] = [];
  const clubPort: SubscriptionReadPort = {
    ...port,
    subscription: async () => clubSubscription(),
    invoice: async (id) => {
      calls.push(`invoice:${id}`);
      return renewal;
    },
    latestPaidInvoice: async () => {
      calls.push('latest-paid');
      return null;
    },
    paidInvoices: async (id, customer) => {
      calls.push(`paid-page:${id}:${customer}`);
      return { object: 'list', has_more: false, data: [renewal] };
    },
  };
  const result = await readClubSubscriptionObservation(clubPort, identity);
  assert({
    given: 'a Club plan',
    should:
      'read the latest invoice and the paid page, never the one-row Premium read',
    actual: [
      result.kind === 'observed' ? result.seatCount : result.kind,
      calls.sort(),
    ],
    expected: [
      14,
      [
        `invoice:${invoice.id}`,
        `paid-page:${identity.vendorSubscriptionId}:${identity.customerId}`,
      ],
    ],
  });
  assert({
    given: 'the Premium subscription (one seat, no Club price)',
    should: 'refuse before following any reference',
    actual: (
      await readClubSubscriptionObservation(
        { ...clubPort, subscription: async () => subscription },
        identity,
      )
    ).kind,
    expected: 'refuse',
  });
  assert({
    given: 'a failing paid page',
    should: 'retry: transport is not nonpayment',
    actual: (
      await readClubSubscriptionObservation(
        {
          ...clubPort,
          paidInvoices: () => Promise.reject(Error('controlled')),
        },
        identity,
      )
    ).kind,
    expected: 'retry',
  });
});

test('a Club read pages past many seat-change invoices to the settling renewal', async () => {
  const change = (n: number) => ({
    ...renewal,
    id: `in_change${n}`,
    billing_reason: 'subscription_update',
    lines: {
      ...renewal.lines,
      data: [
        {
          ...renewal.lines.data[0]!,
          id: `il_change${n}`,
          amount: 500,
          quantity: 1,
          parent: {
            ...renewal.lines.data[0]!.parent,
            subscription_item_details: {
              ...renewal.lines.data[0]!.parent.subscription_item_details,
              proration: true,
            },
          },
        },
      ],
    },
  });
  const changes = Array.from({ length: 120 }, (_, n) => change(n));
  const requested: (string | undefined)[] = [];
  const result = await readClubSubscriptionObservation(
    {
      ...port,
      subscription: async () => clubSubscription(),
      invoice: async () => renewal,
      paidInvoices: async (_id, _customer, startingAfter) => {
        requested.push(startingAfter);
        return startingAfter === undefined
          ? { object: 'list', has_more: true, data: changes.slice(0, 100) }
          : {
              object: 'list',
              has_more: false,
              data: [...changes.slice(100), renewal],
            };
      },
    },
    identity,
  );
  assert({
    given: '120 paid seat-change invoices newer than the renewal',
    should: 'follow one more page and settle the renewal’s period',
    actual: [
      result.kind === 'observed'
        ? result.evidence.settlement.kind
        : result.kind,
      requested,
    ],
    expected: ['paid', [undefined, 'in_change99']],
  });
});
