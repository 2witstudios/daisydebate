import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { Panel } from '../ui/components/panel/panel';

setupRitewayBun();

/**
 * The eyebrow look (uppercase title, borderless card) is a design-system
 * visual contract: the heading's role and level are asserted in the
 * component test, and only the classes carry the look.
 */
describe('Panel markup', () => {
  test('sets the title as a quiet eyebrow heading', () => {
    const html = renderMarkup(
      h(Panel, { title: 'Online', children: h('p', null, 'b') }),
    );
    assert({
      given: 'a panel title',
      should: 'render it as an uppercase h2 with no border on the card',
      actual: [
        /<h2[^>]*uppercase[^>]*>Online<\/h2>/.test(html),
        html.includes('border'),
      ],
      expected: [true, false],
    });
  });
});
