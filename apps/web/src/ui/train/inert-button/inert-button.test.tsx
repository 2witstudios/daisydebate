import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { InertButton } from './inert-button';

setupRitewayBun();

describe('InertButton', () => {
  test('disabled with its reason', () => {
    const html = renderToString(
      h(InertButton, {
        action: { kind: 'inert', reason: 'Not yet.' },
        children: 'Change goal',
      }),
    );
    assert({
      given: 'an inert action',
      should: 'render a disabled button that states the reason',
      actual: [
        html.includes('disabled=""'),
        html.includes('title="Not yet."'),
        html.includes('Change goal'),
        html.includes('. Not yet.'),
      ],
      expected: [true, true, true, true],
    });
  });
});
