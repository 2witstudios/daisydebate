import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { buttonClass } from '../ui/components/button/button-class';
import GlobalError from './global-error';

setupRitewayBun();

describe('GlobalError', () => {
  test('renders its own document, defaulting to dark with no cookie', () => {
    const html = renderToString(
      h(GlobalError, {
        error: Object.assign(new Error('boom'), { digest: 'd1' }),
        retry: () => undefined,
      }),
    );
    assert({
      given: 'a root-layout failure with no theme cookie (server render)',
      should: 'render its own <html data-theme="dark"> and <body>, once each',
      actual: [
        html.includes('<html lang="en" data-theme="dark">'),
        html.split('<body').length - 1,
        html.includes('correlation identifier') && html.includes('d1'),
      ],
      expected: [true, 1, true],
    });
  });

  test('offers the retry as a styled button', () => {
    const html = renderToString(
      h(GlobalError, {
        error: Object.assign(new Error('boom'), { digest: 'd1' }),
        retry: () => undefined,
      }),
    );
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
