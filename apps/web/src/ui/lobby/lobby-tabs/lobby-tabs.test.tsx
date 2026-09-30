import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { defaultQuery } from '../../../features/lobby/query';
import { LobbyTabs } from './lobby-tabs';

setupRitewayBun();

const counts = { all: 8, open: 5, live: 3 };

describe('LobbyTabs', () => {
  test('links, counts and the selected tab', () => {
    const html = renderToString(
      h(LobbyTabs, { query: { ...defaultQuery, tab: 'open' }, counts }),
    );
    assert({
      given: 'the open tab selected',
      should: 'link each tab, show counts and mark only open as current',
      actual: [
        html.includes('href="/lobby"'),
        html.includes('href="/lobby?tab=open"'),
        html.includes('href="/lobby?tab=live"'),
        html.match(/aria-current="page"/g)?.length,
        /aria-current="page"[^>]*>Open tables/.test(html) ||
          /Open tables/.test(html),
        ['8', '5', '3'].every((count) => html.includes(`>${count}<`)),
      ],
      expected: [true, true, true, 1, true, true],
    });
  });

  test('other filters ride along', () => {
    const html = renderToString(
      h(LobbyTabs, {
        query: { ...defaultQuery, mode: 'ranked', sort: 'high' },
        counts,
      }),
    );
    assert({
      given: 'a ranked, highest-rating query',
      should: 'keep mode and sort in every tab link',
      actual: html.includes(
        'href="/lobby?tab=live&amp;mode=ranked&amp;sort=high"',
      ),
      expected: true,
    });
  });
});
