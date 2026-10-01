import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { CheckList } from './check-list';

setupRitewayBun();

describe('CheckList', () => {
  test('one item per entry, each with a decorative check', () => {
    const html = renderToString(h(CheckList, { items: ['One', 'Two'] }));
    assert({
      given: 'two items',
      should: 'render two list items with two icons',
      actual: [
        html.match(/<li /g)?.length,
        html.match(/<svg/g)?.length,
        html.includes('Two'),
      ],
      expected: [2, 2, true],
    });
  });
});
