import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { IconButtonInert } from './icon-button-inert';

setupRitewayBun();

describe('IconButtonInert', () => {
  test('named, disabled and explained', () => {
    const html = renderToString(
      h(IconButtonInert, { label: 'Detach card', symbol: 'x' }),
    );
    assert({
      given: 'a detach control',
      should: 'be a disabled button with an accessible name and a reason',
      actual: [
        /<button [^>]*disabled=""/.test(html),
        html.includes('aria-label="Detach card"'),
        html.includes('Detach card needs the Prep service'),
      ],
      expected: [true, true, true],
    });
  });
});
