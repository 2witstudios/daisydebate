import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { FactList } from './fact-list';

setupRitewayBun();

describe('FactList', () => {
  test('a term and a description per fact', () => {
    const html = renderToString(
      h(FactList, {
        facts: [
          ['Rating', 'Unrated'],
          ['Judging', 'One judge'],
        ],
      }),
    );
    assert({
      given: 'two facts',
      should: 'render two dt and two dd',
      actual: [
        html.match(/<dt /g)?.length,
        html.match(/<dd /g)?.length,
        html.includes('Unrated'),
      ],
      expected: [2, 2, true],
    });
  });
});
