import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { inertActions } from '../../../features/prep/actions';
import { InertActionButton } from './inert-action';

setupRitewayBun();

describe('InertActionButton', () => {
  test('disabled with its reason', () => {
    const html = renderToString(
      h(InertActionButton, {
        action: inertActions.saveSearch,
        symbol: 'bookmark',
      }),
    );
    assert({
      given: 'the save-search action',
      should: 'render a disabled button described by its reason',
      actual: [
        /<button [^>]*disabled=""/.test(html),
        html.includes('Save this search'),
        html.includes('Saving a search needs the Prep service'),
        html.includes('aria-describedby="inert-save-this-search"'),
        html.includes('id="inert-save-this-search"'),
      ],
      expected: [true, true, true, true, true],
    });
  });
});
