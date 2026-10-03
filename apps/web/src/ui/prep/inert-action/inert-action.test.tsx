import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { inertActions } from '../../../features/prep/actions';
import { InertActionButton } from './inert-action';

setupRitewayBun();

describe('InertActionButton', () => {
  test('a working link worded by the action', () => {
    const html = renderToString(
      h(InertActionButton, {
        action: inertActions.saveSearch,
        symbol: 'bookmark',
      }),
    );
    assert({
      given: 'the save-search action',
      should:
        'render a link to the same page with the label, not a disabled button',
      actual: [
        html.includes('href="?did=Save+this+search"'),
        html.includes('Save this search'),
        html.includes('disabled=""'),
        html.includes('<button'),
      ],
      expected: [true, true, false, false],
    });
  });

  test('a label the screen words differently', () => {
    const html = renderToString(
      h(InertActionButton, {
        action: inertActions.saveSearch,
        label: 'Save',
      }),
    );
    assert({
      given: 'an overriding label',
      should: 'carry the overriding label to the banner',
      actual: html.includes('href="?did=Save"'),
      expected: true,
    });
  });
});
