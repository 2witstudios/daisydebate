import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { inertReason } from '../../../features/watch/actions';
import { InertButton } from './inert-button';

setupRitewayBun();

describe('InertButton', () => {
  test('disabled, with its reason', () => {
    const html = renderToString(
      h(InertButton, { action: 'follow', children: 'Follow' }),
    );
    assert({
      given: 'an inert follow button',
      should: 'be a disabled button that carries the reason',
      actual: [
        /<button [^>]*disabled=""/.test(html),
        html.includes(`title="${inertReason('follow')}"`),
        html.includes(inertReason('follow')),
      ],
      expected: [true, true, true],
    });
  });
});
