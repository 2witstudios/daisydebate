import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PageFrame, PageHeader } from './page-frame';

setupRitewayBun();

describe('PageFrame and PageHeader', () => {
  test('one h1 with lede and actions inside the column', () => {
    const html = renderToString(
      h(PageFrame, {
        children: h(PageHeader, {
          title: 'Tournaments',
          lede: 'Events.',
          actions: h('a', { href: '/x' }, 'Go'),
        }),
      }),
    );
    assert({
      given: 'a framed header with lede and action',
      should: 'render one h1, the lede and the action',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('Events.'),
        html.includes('>Go<'),
        html.includes('max-w-dash-column'),
      ],
      expected: [1, true, true, true],
    });
  });
});
