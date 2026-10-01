import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { AutoAdvance } from './auto-advance';

setupRitewayBun();

describe('AutoAdvance', () => {
  test('refreshes to the next step after the delay', () => {
    const html = renderToString(
      h(AutoAdvance, {
        advance: { afterSeconds: 5, href: '/ranked?step=offer' },
      }),
    );
    assert({
      given: 'an advance of 5 seconds to the offer',
      should: 'render a refresh meta for that URL',
      actual:
        html.includes('http-equiv="refresh"') &&
        html.includes('content="5;url=/ranked?step=offer"'),
      expected: true,
    });
  });
});
