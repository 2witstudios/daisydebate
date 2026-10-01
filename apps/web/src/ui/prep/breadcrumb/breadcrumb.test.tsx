import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Breadcrumb } from './breadcrumb';

setupRitewayBun();

describe('Breadcrumb', () => {
  test('links and the current page', () => {
    const html = renderToString(
      h(Breadcrumb, {
        crumbs: [
          { label: 'Prep', href: '/prep' },
          { label: 'Cards' },
          { label: 'New card' },
        ],
      }),
    );
    assert({
      given: 'three crumbs, the last being the page',
      should: 'link only the first, and mark the last as the current page',
      actual: [
        html.match(/<a /g)?.length,
        /aria-current="page"[^>]*>New card/.test(html),
        html.includes('aria-label="Breadcrumb"'),
      ],
      expected: [1, true, true],
    });
  });
});
