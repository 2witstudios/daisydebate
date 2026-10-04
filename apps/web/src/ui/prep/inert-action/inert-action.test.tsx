import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { inertActions } from '../../../features/prep/actions';
import { InertActionButton } from './inert-action';

setupRitewayBun();

describe('InertActionButton', () => {
  test('disabled', () => {
    const html = renderToString(
      h(InertActionButton, {
        action: inertActions.saveSearch,
        symbol: 'bookmark',
      }),
    );
    assert({
      given: 'the save-search action',
      should: 'render a disabled button with its label',
      actual: [
        /<button [^>]*disabled=""/.test(html),
        html.includes('Save this search'),
      ],
      expected: [true, true],
    });
  });
});
