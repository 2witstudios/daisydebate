import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { AppShell } from './app-shell';
import { createInitialState } from '../../store/state';
import { setUiState } from '../../store/store';

setupRitewayBun();

const count = (html: string, needle: string): number =>
  html.split(needle).length - 1;

const render = (): string => {
  setUiState(createInitialState());
  return renderToString(
    h(AppShell, {
      rail: h('p', null, 'rail-content'),
      children: h('p', null, 'page'),
    }),
  );
};

describe('AppShell', () => {
  test('leaves the single main landmark to the root layout', () => {
    const html = render();
    assert({
      given: 'the shell rendered inside the layout-owned <main>',
      should: 'add no main of its own; one banner, one primary nav, one aside',
      actual: [
        count(html, '<main'),
        count(html, 'role="main"'),
        count(html, '<header'),
        count(html, '<nav'),
        count(html, '<aside'),
      ],
      expected: [0, 0, 1, 1, 1],
    });
  });

  test('names its landmarks', () => {
    const html = render();
    assert({
      given: 'the shell landmarks',
      should: 'label the navigation "Primary" and the rail "Sidebar"',
      actual: [
        /<nav[^>]* aria-label="Primary"/.test(html),
        /<aside[^>]* aria-label="Sidebar"/.test(html),
      ],
      expected: [true, true],
    });
  });

  test('places children in the content column and the rail in the aside', () => {
    const html = render();
    const aside = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
    assert({
      given: 'page content and rail content',
      should: 'render the page outside the aside and the rail inside it',
      actual: [
        html.includes('<p>page</p>'),
        aside.includes('<p>page</p>'),
        aside.includes('<p>rail-content</p>'),
      ],
      expected: [true, false, true],
    });
  });
});
