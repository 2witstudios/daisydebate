import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Dashboard } from './dashboard';
import { tiles } from './tiles';
import { occurrences, renderInStore } from '../test-support/render-in-store';

setupRitewayBun();

const render = (): string => renderInStore(h(Dashboard));

describe('Dashboard', () => {
  test('links every configured destination from a named list', () => {
    const html = render();
    const start = html.indexOf('aria-label="Debate destinations"');
    const list = html.slice(start, html.indexOf('</ul>', start));
    assert({
      given: 'the home dashboard',
      should: 'link each tile destination exactly once inside the named list',
      actual: [
        start > -1,
        tiles.map((tile) => occurrences(list, `href="${tile.href}"`)),
      ],
      expected: [true, tiles.map(() => 1)],
    });
  });

  test('keeps the page outline valid inside the shell-owned <main>', () => {
    const html = render();
    assert({
      given: "the dashboard rendered inside AppShell's <main>",
      should:
        'carry exactly one h1, no h3 before it has an h2, and no own main',
      actual: [
        occurrences(html, '<h1'),
        occurrences(html, '<h3'),
        occurrences(html, '<main'),
      ],
      expected: [1, 0, 0],
    });
  });
});
