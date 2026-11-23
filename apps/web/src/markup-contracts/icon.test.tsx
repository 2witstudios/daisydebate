import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { Icon } from '../ui/components/icon/icon';

setupRitewayBun();

/**
 * A decorative icon is an `<svg>` with no role: the accessibility tree the
 * role helper reads shows an aria-hidden svg and an exposed one alike, so
 * the hiding is asserted on the markup. The drawing (path data, box size) is
 * the icon set's visual contract with no role, name or state.
 */
describe('Icon markup', () => {
  test('renders decorative by default', () => {
    const html = renderMarkup(h(Icon, { name: 'swords' }));
    assert({
      given: 'an icon without a label',
      should: 'hide from assistive technology',
      actual: html.includes('aria-hidden="true"'),
      expected: true,
    });
  });

  test('renders the requested path data at the requested size', () => {
    const html = renderMarkup(h(Icon, { name: 'bell', size: 28 }));
    assert({
      given: 'a bell icon at size 28',
      should: 'use the bell path and the 28px box',
      actual: [
        html.includes('M6 8a6 6 0 0 1 12 0'),
        html.includes('width="28"'),
      ],
      expected: [true, true],
    });
  });
});
