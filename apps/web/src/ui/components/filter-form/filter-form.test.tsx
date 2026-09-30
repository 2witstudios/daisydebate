import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ClearFilters, FilterFooter } from './filter-form';

setupRitewayBun();

describe('filter form parts', () => {
  test('Clear is a link to the cleared URL', () => {
    assert({
      given: 'a clear href',
      should: 'render a Clear link',
      actual: /href="\/tournaments\?tab=live"[^>]*>Clear</.test(
        renderToString(h(ClearFilters, { href: '/tournaments?tab=live' })),
      ),
      expected: true,
    });
  });

  test('the footer shows the count, extra controls and a submit Apply', () => {
    const html = renderToString(
      h(FilterFooter, {
        resultLabel: '4 rooms',
        children: h('span', null, 'extra'),
      }),
    );
    assert({
      given: 'a footer with an extra control',
      should: 'render count, extra and Apply in order',
      actual: [
        html.indexOf('4 rooms') < html.indexOf('extra'),
        html.indexOf('extra') < html.indexOf('Apply'),
        /<button type="submit"[^>]*>Apply</.test(html),
      ],
      expected: [true, true, true],
    });
  });
});
