import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Dashboard } from './dashboard';
import { tiles } from './tiles';
import { createInitialState } from '../store/state';
import { setUiState } from '../store/store';

setupRitewayBun();

const count = (html: string, needle: string): number =>
  html.split(needle).length - 1;

const render = (): string => {
  setUiState(createInitialState());
  return renderToString(h(Dashboard));
};

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

  test('keeps the page outline valid inside the root layout', () => {
    const html = render();
    assert({
      given: 'the dashboard rendered inside the layout-owned <main>',
      should: 'carry exactly one h1 and no main landmark of its own',
      actual: [count(html, '<h1'), count(html, '<main')],
      expected: [1, 0],
    });
  });
});
