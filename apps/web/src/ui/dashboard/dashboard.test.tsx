import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Dashboard } from './dashboard';
import { tiles } from './tiles';
import { createInitialState } from '../store/state';
import { UiStoreProvider } from '../store/store';

setupRitewayBun();

const count = (html: string, needle: string): number =>
  html.split(needle).length - 1;

const render = (): string =>
  renderToString(
    h(UiStoreProvider, {
      initialState: createInitialState(),
      children: h(Dashboard),
    }),
  );

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
        tiles.map((tile) => count(list, `href="${tile.href}"`)),
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
      actual: [count(html, '<h1'), count(html, '<h3'), count(html, '<main')],
      expected: [1, 0, 0],
    });
  });
});
