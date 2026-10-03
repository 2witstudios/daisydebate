import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { actionLabel } from '../../../features/watch/actions';
import { InertButton } from './inert-button';

setupRitewayBun();

describe('InertButton', () => {
  test('a working link worded by the action', () => {
    const html = renderToString(
      h(InertButton, { action: 'follow', children: 'Follow' }),
    );
    assert({
      given: 'a follow control with no backend',
      should:
        'render a link that answers on the same page, never a disabled button',
      actual: [
        html.includes(`href="?did=${actionLabel('follow')}"`),
        html.includes('Follow'),
        html.includes('disabled=""'),
        html.includes('<button'),
      ],
      expected: [true, true, false, false],
    });
  });
});
