import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { IconButtonInert } from './icon-button-inert';

setupRitewayBun();

describe('IconButtonInert', () => {
  test('named and disabled', () => {
    const html = renderToString(
      h(IconButtonInert, { label: 'Detach card', symbol: 'x' }),
    );
    assert({
      given: 'a detach control',
      should: 'be a disabled button with an accessible name',
      actual: [
        /<button [^>]*disabled=""/.test(html),
        html.includes('aria-label="Detach card"'),
      ],
      expected: [true, true],
    });
  });
});
