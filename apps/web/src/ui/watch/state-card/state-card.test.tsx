import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { StateCard } from './state-card';

setupRitewayBun();

describe('StateCard', () => {
  test('a page-level state', () => {
    const html = renderToString(
      h(StateCard, {
        icon: 'eye',
        title: 'Nothing here',
        level: 'h1',
        actions: h('a', { href: '/x' }, 'Go'),
        children: h('p', null, 'Why.'),
      }),
    );
    assert({
      given: 'a card that is the whole page',
      should: 'use an h1 and show its text and actions',
      actual: [
        html.includes('<h1'),
        html.includes('Why.'),
        html.includes('href="/x"'),
      ],
      expected: [true, true, true],
    });
  });

  test('a card inside a list', () => {
    const html = renderToString(
      h(StateCard, {
        icon: 'eye',
        title: 'Empty',
        children: h('p', null, 'Text'),
      }),
    );
    assert({
      given: 'a card with no level and no actions',
      should: 'use an h2 and render no action row',
      actual: [html.includes('<h2'), html.includes('mt-2')],
      expected: [true, false],
    });
  });
});
