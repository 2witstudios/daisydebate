import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  entryLimitText,
  eventUpgradeText,
  formatUsd,
  perSeatPriceText,
} from './price-text';
setupRitewayBun();

test('formatUsd', () => {
  assert({
    given: 'whole-dollar amounts in cents',
    should: 'show dollars without cents',
    actual: [0, 1000, 2000, 19900, 123400].map(formatUsd),
    expected: ['$0', '$10', '$20', '$199', '$1,234'],
  });
  assert({
    given: 'amounts with cents',
    should: 'keep two decimal places',
    actual: [2050, 2005, 99].map(formatUsd),
    expected: ['$20.50', '$20.05', '$0.99'],
  });
  const refused = [-1, 10.5, Number.NaN].map((cents) => {
    try {
      formatUsd(cents);
      return 'formatted';
    } catch (error) {
      return error instanceof RangeError ? 'refused' : 'other';
    }
  });
  assert({
    given: 'a negative, fractional or non-numeric amount',
    should: 'refuse it rather than print a wrong price',
    actual: refused,
    expected: ['refused', 'refused', 'refused'],
  });
});

test('per-seat and per-event wording', () => {
  assert({
    given: 'a Club seat price',
    should: 'read as a per-seat monthly price in prose',
    actual: perSeatPriceText(1000),
    expected: '$10 per seat a month',
  });
  assert({
    given: 'a capped and an unlimited Host tier',
    should: 'name each by its entry limit',
    actual: [entryLimitText(64), entryLimitText(null)],
    expected: ['Up to 64 entries', 'Unlimited entries'],
  });
  assert({
    given: 'a capped and an unlimited event upgrade',
    should: 'put the price before the limit',
    actual: [
      eventUpgradeText({ entryLimit: 64, cents: 9900 }),
      eventUpgradeText({ entryLimit: null, cents: 19900 }),
    ],
    expected: ['$99 up to 64 entries', '$199 unlimited'],
  });
});
