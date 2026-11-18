import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  normalizeSubscriptionObservation,
  observedTerms,
} from './subscription-observation';
import {
  identity,
  subscription,
  invoice,
} from './subscription-observation.test-support';
import { premiumOffer } from './premium-price';

setupRitewayBun();

const priced = (unitAmount: number) => ({
  ...subscription,
  items: {
    ...subscription.items,
    data: [
      {
        ...subscription.items.data[0]!,
        price: {
          ...subscription.items.data[0]!.price,
          unit_amount: unitAmount,
          lookup_key: unitAmount === 2000 ? premiumOffer.lookupKey : null,
        },
      },
    ],
  },
});
const billed = (amount: number) => ({
  ...invoice,
  lines: {
    ...invoice.lines,
    data: [{ ...invoice.lines.data[0]!, amount }],
  },
});
const observe = (sub: unknown, current: unknown) =>
  normalizeSubscriptionObservation({
    identity,
    subscription: sub,
    latestInvoice: current,
    latestPaidInvoice: null,
  });
const summary = (sub: unknown, current: unknown) => {
  const observed = observe(sub, current);
  return observed.kind === 'observed'
    ? [observed.evidence.settlement.kind, observed.amountMinor]
    : [observed.kind];
};

test('the $20 offer is sold at $20 and the $10 subscriber keeps $10', () => {
  assert({
    given:
      'a new $20 subscription paid at $20, and a grandfathered $10 subscription paid at $10',
    should: 'observe both as paid, each at its own verified amount',
    actual: [
      summary(priced(2000), billed(2000)),
      summary(priced(1000), billed(1000)),
    ],
    expected: [
      ['paid', 2000],
      ['paid', 1000],
    ],
  });
});

test('an invoice settles a period only at its own subscription amount', () => {
  assert({
    given:
      'a $20 subscription with a $10 invoice line, a $10 subscription with a $20 line, and an unknown price',
    should:
      'leave the mismatched periods unpaid and refuse a price that is neither offer',
    actual: [
      summary(priced(2000), billed(1000)),
      summary(priced(1000), billed(2000)),
      summary(priced(1500), billed(1500)),
    ],
    expected: [['unpaid', 2000], ['unpaid', 1000], ['refuse']],
  });
});

test('renewal is off at the period end or on a set cancel date', () => {
  const terms = (over: Record<string, unknown>) => {
    const observed = observe({ ...priced(2000), ...over }, billed(2000));
    return observed.kind === 'observed'
      ? [observed.evidence.settlement.kind, observedTerms(observed)]
      : null;
  };
  assert({
    given:
      'a $20 subscriber renewing, cancelling at period end, and cancelled for a set date',
    should:
      'keep paid access in each case and store renewal off for both cancellations, at $20',
    actual: [
      terms({}),
      terms({ cancel_at_period_end: true }),
      terms({ cancel_at: subscription.items.data[0]!.current_period_end }),
    ],
    expected: [
      ['paid', { renewalOff: false, amountMinor: 2000 }],
      ['paid', { renewalOff: true, amountMinor: 2000 }],
      ['paid', { renewalOff: true, amountMinor: 2000 }],
    ],
  });
});
