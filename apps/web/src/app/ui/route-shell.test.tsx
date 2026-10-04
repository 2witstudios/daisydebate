import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { RouteShell } from './route-shell';

setupRitewayBun();

const textsOf = (html: string, tag: string): readonly string[] =>
  [...html.matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'g'))].map(
    (match) => match[1] ?? '',
  );

describe('RouteShell', () => {
  test('titles the page with a single h1 and says it is coming', () => {
    const html = renderToString(h(RouteShell, { title: 'Ranked' }));
    assert({
      given: 'a title',
      should: 'render the title as the only h1 and say coming soon',
      actual: [textsOf(html, 'h1'), html.includes('Coming soon.')],
      expected: [['Ranked'], true],
    });
  });
});
