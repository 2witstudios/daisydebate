import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { emptyAnswers } from '../features/onboarding/answers';
import { AboutStep } from '../ui/onboarding/questions/questions';

setupRitewayBun();

/**
 * The club-name field is revealed by CSS alone (the `onboarding-club-reveal`
 * utility in app/theme/onboarding.css), so the class is the contract.
 */
describe('AboutStep markup', () => {
  test('a club name waits for “I have a club”', () => {
    const html = renderMarkup(
      h(AboutStep, {
        answers: { ...emptyAnswers, wants: ['debate', 'watch'], club: 'own' },
        action: () => undefined,
        pending: false,
        backHref: '/onboarding/debate?next=%2Flobby',
        skip: null,
      }),
    );
    assert({
      given: 'a member on their own',
      should: 'wrap the club-name field in the CSS reveal',
      actual:
        /class="[^"]*onboarding-club-reveal[^"]*"><label for="club-name"/.test(
          html,
        ),
      expected: true,
    });
  });
});
