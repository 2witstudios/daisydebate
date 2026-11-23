import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { buttonClass } from '../ui/components/button/button-class';
import ErrorBoundary from '../app/error';

setupRitewayBun();

/**
 * Under the Tailwind base reset a bare button is unstyled, so the retry
 * wearing the primary button classes is a design-system visual contract
 * with no accessible equivalent.
 */
describe('ErrorBoundary markup', () => {
  test('offers the retry as a styled button', () => {
    const html = renderMarkup(
      h(ErrorBoundary, {
        error: Object.assign(new Error('boom'), { digest: 'd1' }),
        retry: () => undefined,
      }),
    );
    assert({
      given: 'a route error, under the Tailwind base reset',
      should: 'render "Try again" with the primary button classes',
      actual: /<button[^>]* class="([^"]*)"[^>]*>Try again<\/button>/.exec(
        html,
      )?.[1],
      expected: buttonClass('primary'),
    });
  });
});
