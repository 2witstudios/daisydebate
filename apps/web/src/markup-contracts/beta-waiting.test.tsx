import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { BetaWaiting } from '../ui/beta/beta-waiting';

setupRitewayBun();

/**
 * The waiting page works before hydration (ADR 0075): the server render
 * carries no script. A script element has no role, so its absence is read
 * from the markup.
 */
describe('BetaWaiting markup', () => {
  test('a pending account is told it is on the list, with its account one link away', () => {
    const html = renderMarkup(
      h(BetaWaiting, {
        username: 'ada',
        reason: 'pending',
        ageHref: '/onboarding/age?next=%2Fbeta',
      }),
    );
    assert({
      given: 'a pending account',
      should: 'render without a script, so it works before hydration',
      actual: html.includes('<script'),
      expected: false,
    });
  });
});
