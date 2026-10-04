import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { InertButton } from './inert-button';

setupRitewayBun();

describe('InertButton', () => {
  test('disabled', () => {
    const html = renderToString(
      h(InertButton, { action: 'follow', children: 'Follow' }),
    );
    assert({
      given: 'an inert follow button',
      should: 'be a disabled button with its label',
      actual: [
        /<button [^>]*disabled=""/.test(html),
        html.includes('>Follow</button>'),
      ],
      expected: [true, true],
    });
  });
});
