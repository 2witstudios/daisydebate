import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { buttonClass } from '../ui/components/button/button-class';
import GlobalError from '../app/global-error';

setupRitewayBun();

/**
 * Global error replaces the root layout, so its subject is the document
 * shell itself: its own <html> with the theme attribute and one <body>,
 * which no role reads. The retry's primary button classes are a
 * design-system visual contract under the Tailwind base reset.
 */
const renderFailure = () =>
  renderMarkup(
    h(GlobalError, {
      error: Object.assign(new Error('boom'), { digest: 'd1' }),
      retry: () => undefined,
    }),
  );

describe('GlobalError markup', () => {
  test('renders its own document, defaulting to light with no cookie', () => {
    const html = renderFailure();
    assert({
      given: 'a root-layout failure with no theme cookie (server render)',
      should: 'render its own <html data-theme="light"> and <body>, once each',
      actual: [
        html.includes('<html lang="en" data-theme="light">'),
        html.split('<body').length - 1,
        html.includes('correlation identifier') && html.includes('d1'),
      ],
      expected: [true, 1, true],
    });
  });

  test('offers the retry as a styled button', () => {
    const html = renderFailure();
    assert({
      given: 'a root-layout failure',
      should: 'render "Try again" with the primary button classes',
      actual: /<button[^>]* class="([^"]*)"[^>]*>Try again<\/button>/.exec(
        html,
      )?.[1],
      expected: buttonClass('primary'),
    });
  });
});
