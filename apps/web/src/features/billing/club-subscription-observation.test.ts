import { assert, setupRitewayBun, test } from 'riteway/bun';
import { subscriptionAccess } from '@daisy/auth/authorization';
import { normalizeClubSubscriptionObservation } from './club-subscription-observation';
import {
  identity,
  start,
  end,
  iso,
  subscription,
  invoice,
  prior,
} from './subscription-observation.test-support';
import {
  seats,
  month,
  line,
  settling,
  clubSubscription,
  renewal,
  previousRenewal,
} from './club-subscription-observation.test-support';

setupRitewayBun();

/** Adding 3 seats mid-period: a credit for the old quantity and a charge for the new. */
const seatChange = {
  ...invoice,
  id: 'in_seat_change',
  billing_reason: 'subscription_update',
  lines: {
    has_more: false,
    data: [
      {
        ...line,
        id: 'il_credit',
        quantity: seats,
        amount: -7000,
        period: { start: start + 15 * 86400, end },
        parent: {
          ...line.parent,
          subscription_item_details: {
            ...line.parent.subscription_item_details,
            proration: true,
          },
        },
      },
      {
        ...line,
        id: 'il_charge',
        quantity: seats + 3,
        amount: 8500,
        period: { start: start + 15 * 86400, end },
        parent: {
          ...line.parent,
          subscription_item_details: {
            ...line.parent.subscription_item_details,
            proration: true,
          },
        },
      },
    ],
  },
};
const observe = (
  sub: unknown,
  latest: unknown,
  paid: readonly unknown[] = [],
  hasMore = false,
) =>
  normalizeClubSubscriptionObservation({
    identity,
    subscription: sub,
    latestInvoice: latest,
    paidInvoices: { hasMore, data: paid },
  });
const paidPeriod = (from: number, to: number, invoiceId: string) => ({
  kind: 'paid' as const,
  invoiceId,
  period: {
    subscriptionId: identity.subscriptionId,
    startsAt: iso(from),
    endsAt: iso(to),
  },
});

test('a paid Club renewal settles its period and reports the seats Stripe bills', () => {
  assert({
    given: 'a 14-seat Club plan whose renewal invoice paid 14 × $10',
    should: 'observe the paid period, the seat price and 14 seats',
    actual: observe(clubSubscription(), renewal, [renewal]),
    expected: {
      kind: 'observed',
      evidence: {
        lifecycle: 'active',
        settlement: paidPeriod(start, end, invoice.id),
      },
      cancelAtPeriodEnd: false,
      cancelAt: null,
      amountMinor: 1000,
      seatCount: seats,
    },
  });
});

test('a seat-change invoice is owned but never settles a period', () => {
  const after = clubSubscription(seats + 3, {
    latest_invoice: seatChange.id,
  });
  const result = observe(after, seatChange, [seatChange, renewal]);
  assert({
    given: 'a paid prorated seat increase newer than the renewal',
    should: 'keep the renewal’s period and report the raised seat count',
    actual:
      result.kind === 'observed'
        ? [result.evidence.settlement, result.seatCount]
        : result,
    expected: [paidPeriod(start, end, invoice.id), seats + 3],
  });
  assert({
    given: 'only seat-change invoices on a page with more behind it',
    should: 'refuse (retry later) rather than read the plan as unpaid',
    actual: observe(after, seatChange, [seatChange], true).kind,
    expected: 'refuse',
  });
  assert({
    given: 'only seat-change invoices and nothing behind them',
    should: 'grant nothing: an increase alone never pays a period',
    actual: (() => {
      const value = observe(after, seatChange, [seatChange]);
      return value.kind === 'observed'
        ? subscriptionAccess(value.evidence, iso(start + 86400)).kind
        : value.kind;
    })(),
    expected: 'none',
  });
});

test('a renewal at the wrong total, price or seat count settles nothing', () => {
  const short = {
    ...invoice,
    lines: {
      ...invoice.lines,
      data: [{ ...line, quantity: seats, amount: 1000 * seats - 1 }],
    },
  };
  const prorated = {
    ...invoice,
    lines: {
      ...invoice.lines,
      data: [
        {
          ...line,
          quantity: seats,
          amount: 1000 * seats,
          parent: {
            ...line.parent,
            subscription_item_details: {
              ...line.parent.subscription_item_details,
              proration: true,
            },
          },
        },
      ],
    },
  };
  const settlement = (latest: unknown) => {
    const value = observe(clubSubscription(), latest, [latest]);
    return value.kind === 'observed' ? value.evidence.settlement.kind : value;
  };
  assert({
    given: 'a renewal one cent short, and one marked as proration',
    should: 'leave the plan unpaid',
    actual: [settlement(short), settlement(prorated)],
    expected: ['unpaid', 'unpaid'],
  });
  assert({
    given: 'the Premium price on a Club subscription, or another price id',
    should: 'refuse the subscription',
    actual: [
      observe(
        {
          ...clubSubscription(),
          items: {
            ...subscription.items,
            data: [{ ...subscription.items.data[0]!, quantity: seats }],
          },
        },
        renewal,
      ).kind,
      normalizeClubSubscriptionObservation({
        identity: { ...identity, priceId: 'price_other' },
        subscription: clubSubscription(),
        latestInvoice: renewal,
        paidInvoices: { hasMore: false, data: [renewal] },
      }).kind,
    ],
    expected: ['refuse', 'refuse'],
  });
});

test('a failed Club renewal keeps the previous period for the same grace as Premium', () => {
  const failed = settling(invoice, seats, {
    status: 'open',
    amount_remaining: 1000 * seats,
    status_transitions: { paid_at: null },
  });
  const result = observe(
    clubSubscription(seats, { status: 'past_due' }),
    failed,
    [previousRenewal],
  );
  assert({
    given: 'past_due with an attempted, unpaid renewal and a paid prior period',
    should: 'record renewal_failed naming the previous paid period',
    actual: result.kind === 'observed' ? result.evidence.settlement : result,
    expected: {
      kind: 'renewal_failed',
      invoiceId: invoice.id,
      period: paidPeriod(start, end, invoice.id).period,
      previous: {
        invoiceId: prior.id,
        period: paidPeriod(start - month, start, prior.id).period,
      },
    },
  });
  assert({
    given: 'that evidence within and beyond seven days of the failed renewal',
    should: 'grant access in grace, then none',
    actual:
      result.kind === 'observed'
        ? [
            subscriptionAccess(result.evidence, iso(start + 6 * 86400)).kind,
            subscriptionAccess(result.evidence, iso(start + 8 * 86400)).kind,
          ]
        : result,
    expected: ['grace', 'none'],
  });
});

test('an invoice owned by another subscription, item or mode refuses the observation', () => {
  const foreign = (delta: object) =>
    observe(clubSubscription(), renewal, [
      {
        ...renewal,
        lines: {
          ...renewal.lines,
          data: [
            {
              ...renewal.lines.data[0]!,
              parent: {
                ...line.parent,
                subscription_item_details: {
                  ...line.parent.subscription_item_details,
                  ...delta,
                },
              },
            },
          ],
        },
      },
    ]).kind;
  assert({
    given: 'a paid page line naming another subscription or item',
    should: 'refuse',
    actual: [
      foreign({ subscription: 'sub_other' }),
      foreign({ subscription_item: 'si_other' }),
      observe(clubSubscription(), { ...renewal, livemode: true }).kind,
      observe(clubSubscription(), renewal, [
        { ...previousRenewal, status: 'open' },
      ]).kind,
    ],
    expected: ['refuse', 'refuse', 'refuse', 'refuse'],
  });
  assert({
    given: 'a subscription whose latest invoice is not the one read',
    should: 'refuse',
    actual: observe(
      clubSubscription(seats, { latest_invoice: 'in_other' }),
      renewal,
    ).kind,
    expected: 'refuse',
  });
});
