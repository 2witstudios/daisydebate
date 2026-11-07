import { assert, setupRitewayBun, test } from 'riteway/bun';
import { normalizeSubscriptionObservation } from './subscription-observation';
import { subscriptionAccess } from '@daisy/auth/authorization';

setupRitewayBun();
import {
  identity,
  start,
  end,
  iso,
  subscription,
  invoice,
  prior,
} from './subscription-observation.test-support';
const observe = (
  sub: unknown = subscription,
  current: unknown = invoice,
  paid: unknown = null,
) =>
  normalizeSubscriptionObservation({
    identity,
    subscription: sub,
    latestInvoice: current,
    latestPaidInvoice: paid,
  });

test('a paid invoice grants its actual line period and preserves cancellation scheduling separately', () => {
  assert({
    given: 'one verified monthly Premium item and its paid invoice',
    should: 'name the local subscription and exact paid interval',
    actual: observe({ ...subscription, cancel_at_period_end: true }),
    expected: {
      kind: 'observed',
      evidence: {
        lifecycle: 'active',
        settlement: {
          kind: 'paid',
          invoiceId: invoice.id,
          period: {
            subscriptionId: identity.subscriptionId,
            startsAt: iso(start),
            endsAt: iso(end),
          },
        },
      },
      cancelAtPeriodEnd: true,
      cancelAt: null,
    },
  });
});

test('all vendor statuses require verified payment and preserve their current lifecycle', () => {
  const statuses = [
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'paused',
    'incomplete',
    'incomplete_expired',
    'trialing',
  ] as const;
  assert({
    given: 'every vendor status with no invoice or paid proof',
    should: 'grant nothing even for active or trialing',
    actual: statuses.map((status) => {
      const result = observe(
        { ...subscription, status, latest_invoice: null },
        null,
      );
      return result.kind === 'observed'
        ? [
            result.evidence.lifecycle,
            subscriptionAccess(result.evidence, iso(start)),
          ]
        : result;
    }),
    expected: statuses.map((status) => [status, { kind: 'none' as const }]),
  });
  const trial = observe(
    { ...subscription, status: 'trialing' },
    {
      ...invoice,
      lines: {
        ...invoice.lines,
        data: [{ ...invoice.lines.data[0]!, amount: 0 }],
      },
    },
  );
  assert({
    given: 'a zero-value paid trial invoice',
    should: 'recognize trialing without inventing a paid Premium period',
    actual: trial.kind === 'observed' ? trial.evidence : trial,
    expected: { lifecycle: 'trialing', settlement: { kind: 'unpaid' } },
  });
});

test('renewal grace requires a failed attempted current invoice and an adjacent paid predecessor', () => {
  const failed = {
    ...invoice,
    status: 'open',
    amount_remaining: 1000,
    status_transitions: { paid_at: null },
  };
  const pastDue = { ...subscription, status: 'past_due' };
  const results = [
    observe(pastDue, failed, prior),
    observe(subscription, failed, prior),
    observe(pastDue, { ...failed, attempted: false, attempt_count: 0 }, prior),
    observe(
      pastDue,
      { ...failed, billing_reason: 'subscription_create' },
      prior,
    ),
    observe(pastDue, failed),
  ];
  assert({
    given:
      'failed renewal, active status, no attempt, initial invoice, and no prior payment',
    should: 'grant grace only for the verified renewal failure',
    actual: results.map((result) =>
      result.kind === 'observed'
        ? subscriptionAccess(result.evidence, iso(start))
        : result,
    ),
    expected: [
      {
        kind: 'grace',
        period: {
          subscriptionId: identity.subscriptionId,
          startsAt: iso(start - 30 * 86400),
          endsAt: iso(start),
        },
        expiresAt: iso(start + 7 * 86400),
      },
      ...Array.from({ length: 4 }, () => ({ kind: 'none' })),
    ],
  });
});

test('cross-customer, wrong price, truncated or unrelated invoice evidence refuses the observation', () => {
  const wrongInvoices = [
    { ...invoice, customer: 'cus_other' },
    { ...invoice, id: 'in_other' },
    { ...invoice, livemode: true },
    { ...invoice, parent: { type: 'quote_details' } },
    { ...invoice, lines: { ...invoice.lines, has_more: true } },
    {
      ...invoice,
      lines: {
        ...invoice.lines,
        data: [
          {
            ...invoice.lines.data[0],
            pricing: {
              type: 'price_details',
              price_details: { price: 'price_other' },
            },
          },
        ],
      },
    },
    {
      ...invoice,
      lines: {
        ...invoice.lines,
        data: [
          {
            ...invoice.lines.data[0],
            parent: {
              type: 'subscription_item_details',
              subscription_item_details: {
                subscription: 'sub_other',
                subscription_item: 'si_fixture',
                proration: false,
              },
            },
          },
        ],
      },
    },
  ];
  assert({
    given:
      'invoice claims that fail ownership, mode, completeness or exact plan binding',
    should: 'refuse without emitting partially trusted access facts',
    actual: wrongInvoices.map((value) => observe(subscription, value)),
    expected: wrongInvoices.map(() => ({ kind: 'refuse' })),
  });
  assert({
    given:
      'wrong subscription, customer, mode, unknown status, extra item, or missing latest invoice',
    should: 'refuse instead of treating SDK types as validation',
    actual: [
      observe({ ...subscription, id: 'sub_other' }),
      observe({ ...subscription, customer: 'cus_other' }),
      observe({ ...subscription, livemode: true }),
      observe({ ...subscription, status: 'unknown' }),
      observe({
        ...subscription,
        items: { ...subscription.items, has_more: true },
      }),
      observe(subscription, null),
    ],
    expected: Array.from({ length: 6 }, () => ({ kind: 'refuse' })),
  });
});

test('unrelated paid periods cannot manufacture contiguous grace or a current paid interval', () => {
  const failed = {
    ...invoice,
    status: 'open',
    amount_remaining: 1000,
    status_transitions: { paid_at: null },
  };
  const unrelated = {
    ...prior,
    lines: {
      ...prior.lines,
      data: [
        {
          ...prior.lines.data[0],
          period: { start: start - 60 * 86400, end: start - 30 * 86400 },
        },
      ],
    },
  };
  const result = observe(
    { ...subscription, status: 'past_due' },
    failed,
    unrelated,
  );
  assert({
    given:
      'a paid historical invoice separated from the failed period by a gap',
    should: 'preserve payment evidence but grant no current grace',
    actual:
      result.kind === 'observed'
        ? subscriptionAccess(result.evidence, iso(start))
        : result,
    expected: { kind: 'none' },
  });
});
