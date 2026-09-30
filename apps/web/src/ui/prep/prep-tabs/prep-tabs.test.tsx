import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PrepTabs } from './prep-tabs';

setupRitewayBun();

describe('PrepTabs', () => {
  test('links, counts and the current tab', () => {
    const html = renderToString(
      h(PrepTabs, {
        label: 'View',
        current: 'cards',
        tabs: [
          { id: 'all', label: 'All', href: '/prep', count: 11 },
          { id: 'cards', label: 'Cards', href: '/prep?view=cards', count: 5 },
          { id: 'plain', label: 'Plain', href: '/prep?view=plain' },
        ],
      }),
    );
    assert({
      given: 'three tabs with cards current',
      should: 'name the nav, link each, count two and mark one current',
      actual: [
        html.includes('aria-label="View"'),
        html.includes('href="/prep?view=cards"'),
        html.match(/aria-current="page"/g)?.length,
        html.includes('>11<'),
        html.match(/font-book/g)?.length,
      ],
      expected: [true, true, 1, true, 2],
    });
  });
});
