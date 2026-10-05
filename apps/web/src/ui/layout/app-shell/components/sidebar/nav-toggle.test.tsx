import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderInStore } from '../../../../test-support/render-in-store';
import { NavToggle } from './nav-toggle';

setupRitewayBun();

describe('NavToggle', () => {
  test('offers to collapse an expanded sidebar', () => {
    const html = renderInStore(h(NavToggle));
    assert({
      given: 'the sidebar in its default state',
      should:
        'be a panel button at the top of the sidebar, not a tab on its edge, named for what it does, expanded, and hidden where it is icons only anyway',
      actual: [
        html.includes('aria-label="Collapse sidebar"'),
        html.includes('aria-expanded="true"'),
        html.includes('max-compact:hidden'),
        html.includes('left-full'),
        html.includes('d="M9 4v16"'),
      ],
      expected: [true, true, true, false, true],
    });
  });
});
