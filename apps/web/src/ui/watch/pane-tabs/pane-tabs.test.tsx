import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PaneTabs } from './pane-tabs';

setupRitewayBun();

describe('PaneTabs', () => {
  test('links with one current', () => {
    const html = renderToString(
      h(PaneTabs, {
        panes: [
          { id: 'a', label: 'A', href: '/x?pane=a', active: false },
          { id: 'b', label: 'B', href: '/x?pane=b', active: true },
        ],
      }),
    );
    assert({
      given: 'two panes, B active',
      should: 'render two links, only B current, hidden above the phone width',
      actual: [
        (html.match(/<a /g) ?? []).length,
        (html.match(/aria-current="page"/g) ?? []).length,
        html.includes('href="/x?pane=a"'),
        html.includes('hidden'),
      ],
      expected: [2, 1, true, true],
    });
  });
});
