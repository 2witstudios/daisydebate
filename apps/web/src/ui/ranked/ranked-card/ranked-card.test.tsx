import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { RankedCard } from './ranked-card';

setupRitewayBun();

describe('RankedCard', () => {
  test('wraps its children in one card', () => {
    const html = renderToString(h(RankedCard, null, h('p', null, 'inside')));
    assert({
      given: 'a child',
      should: 'render it inside one section',
      actual: [html.match(/<section/g)?.length, html.includes('<p>inside</p>')],
      expected: [1, true],
    });
  });
});
