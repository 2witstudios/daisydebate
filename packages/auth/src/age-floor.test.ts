import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ageBand } from './age-band';
import {
  ACCOUNT_AGE_FLOOR,
  RANKED_AGE_FLOOR,
  ageStepDecision,
  rankedAgeAdmitted,
} from './age-floor';

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

test('ranked play admits only the bands at or above the ranked floor', () => {
  // Exactly 18 is the whole month one turns 18; 17y11m is the month before.
  const now = new Date('2026-11-17T12:00:00.000Z');
  assert({
    given: 'the ranked floor, each band, and birth months either side of 18',
    should: 'admit 18 and over only, and never a missing record',
    actual: {
      floor: RANKED_AGE_FLOOR,
      bands: (['under-13', '13-15', '16-17', 'adult', null] as const).map(
        rankedAgeAdmitted,
      ),
      seventeenElevenMonths: rankedAgeAdmitted(ageBand('2008-12', now)),
      exactlyEighteen: rankedAgeAdmitted(ageBand('2008-11', now)),
      lastDayBeforeTheMonth: rankedAgeAdmitted(
        ageBand('2008-11', new Date('2026-10-31T23:59:59.999Z')),
      ),
      firstInstantOfTheMonth: rankedAgeAdmitted(
        ageBand('2008-11', new Date('2026-11-01T00:00:00.000Z')),
      ),
    },
    expected: {
      floor: 18,
      bands: [false, false, false, true, false],
      seventeenElevenMonths: false,
      exactlyEighteen: true,
      lastDayBeforeTheMonth: false,
      firstInstantOfTheMonth: true,
    },
  });
});
