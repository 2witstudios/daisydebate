import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { StateCard } from '../ui/watch/state-card/state-card';

setupRitewayBun();

/**
 * The action row is a layout wrapper with no role or name; only its markup
 * says whether an empty one was rendered.
 */
describe('StateCard markup', () => {
  test('a card inside a list', () => {
    const html = renderMarkup(
      h(StateCard, {
        icon: 'eye',
        title: 'Empty',
        children: h('p', null, 'Text'),
      }),
    );
    assert({
      given: 'a card with no actions',
      should: 'render no action row',
      actual: html.includes('mt-2'),
      expected: false,
    });
  });
});
