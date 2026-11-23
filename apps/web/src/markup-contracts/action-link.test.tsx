import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { ActionLink } from '../ui/watch/action-link/action-link';

setupRitewayBun();

/**
 * The variant is a design-system visual contract with no accessible
 * equivalent: a primary action link wears the primary button classes.
 */
describe('ActionLink markup', () => {
  test('the primary variant', () => {
    const html = renderMarkup(
      h(ActionLink, {
        href: '/lobby',
        variant: 'primary',
        children: 'Open the lobby',
      }),
    );
    assert({
      given: 'a primary action link',
      should: 'carry the primary button classes',
      actual: html.includes('bg-accent'),
      expected: true,
    });
  });
});
