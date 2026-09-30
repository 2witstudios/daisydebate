import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { DetailList } from './detail-list';

setupRitewayBun();

describe('DetailList', () => {
  test('terms and details', () => {
    const html = renderToString(
      h(DetailList, {
        rows: [
          ['Author', '[Author A]'],
          ['Words', '12'],
        ],
      }),
    );
    assert({
      given: 'two rows',
      should: 'render a term and a detail for each',
      actual: [
        html.match(/<dt /g)?.length,
        html.match(/<dd /g)?.length,
        html.includes('[Author A]'),
      ],
      expected: [2, 2, true],
    });
  });
});
