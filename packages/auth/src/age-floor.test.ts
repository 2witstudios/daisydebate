import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ACCOUNT_AGE_FLOOR, ageStepDecision } from './age-floor';

setupRitewayBun();

test('the age step accepts only answers at or above the floor', () => {
  const bands = ['under-13', '13-15', '16-17', 'adult'] as const;
  assert({
    given: 'each band under the beta floor of 16, then the product floor of 13',
    should:
      'refuse under 13 for good, refuse 13-15 only in the beta, and accept 16+',
    actual: [
      bands.map((band) => ageStepDecision(band, 16)),
      bands.map((band) => ageStepDecision(band, 13)),
      ACCOUNT_AGE_FLOOR,
    ],
    expected: [
      ['under-13', 'below-floor', 'accept', 'accept'],
      ['under-13', 'accept', 'accept', 'accept'],
      16,
    ],
  });
});
