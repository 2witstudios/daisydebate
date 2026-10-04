import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { InertButton } from './inert-button';

setupRitewayBun();

describe('InertButton', () => {
  test('a working link', () => {
    const html = renderToString(h(InertButton, { children: 'Change goal' }));
    assert({
      given: 'a control with no backend',
      should:
        'render a link that answers on the same page, never a disabled button',
      actual: [
        html.includes('href="?did=Change+goal"'),
        html.includes('Change goal'),
        html.includes('disabled=""'),
        html.includes('<button'),
      ],
      expected: [true, true, false, false],
    });
  });
});
