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
        'be a button that collapses it, expanded, and hidden where it is icons only anyway',
      actual: [
        html.includes('aria-label="Collapse sidebar"'),
        html.includes('aria-expanded="true"'),
        html.includes('max-compact:hidden'),
      ],
      expected: [true, true, true],
    });
  });
});
