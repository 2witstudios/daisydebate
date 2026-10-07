import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { afterPasskeyHref } from './continue';

setupRitewayBun();

describe('afterPasskeyHref', () => {
  test('where the passkey offer leads', () => {
    assert({
      given: 'a member who has not finished onboarding',
      should: 'lead to the welcome step, carrying the destination',
      actual: afterPasskeyHref('/ranked?tab=a', null),
      expected: '/onboarding/welcome?next=%2Franked%3Ftab%3Da',
    });
    assert({
      given: 'a member who finished onboarding before',
      should: 'go straight to the destination',
      actual: afterPasskeyHref('/ranked?tab=a', '2026-10-05T12:00:00.000Z'),
      expected: '/ranked?tab=a',
    });
    assert({
      given: 'a new member whose destination is already an onboarding step',
      should: 'go to that step once, not wrap onboarding inside onboarding',
      actual: [
        afterPasskeyHref('/onboarding/welcome', null),
        afterPasskeyHref('/onboarding/about?next=%2Franked', null),
      ],
      expected: ['/onboarding/welcome', '/onboarding/about?next=%2Franked'],
    });
    assert({
      given: 'a destination that only starts like an onboarding path',
      should: 'still lead into onboarding',
      actual: afterPasskeyHref('/onboardingx', null),
      expected: '/onboarding/welcome?next=%2Fonboardingx',
    });
  });
});
