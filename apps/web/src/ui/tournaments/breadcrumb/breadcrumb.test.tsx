import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Breadcrumb } from './breadcrumb';

setupRitewayBun();

describe('Breadcrumb', () => {
  test('links before the current page, which is not a link', () => {
    const html = renderToString(
      h(Breadcrumb, {
        trail: [
          { label: 'Tournaments', href: '/tournaments' },
          { label: 'Autumn Open' },
        ],
      }),
    );
    assert({
      given: 'a two-step trail',
      should: 'link the first and mark the last current',
      actual: [
        html.includes('aria-label="Breadcrumb"'),
        html.includes('href="/tournaments"'),
        /aria-current="page"[^>]*>Autumn Open</.test(html),
        html.match(/<a /g)?.length,
      ],
      expected: [true, true, true, 1],
    });
  });
});
