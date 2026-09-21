import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { RouteShell } from './route-shell';

setupRitewayBun();

describe('RouteShell', () => {
  test('lists the planned capabilities under the page heading', () => {
    const html = renderToString(
      h(RouteShell, {
        title: 'Ranked',
        lede: 'Rated competitive debates.',
        planned: ['Matchmaking', 'Season ladders'],
      }),
    );
    assert({
      given: 'a title, lede, and two planned capabilities',
      should: 'render one h1, the lede, and each capability as a list item',
      actual: html,
      expected:
        '<section><h1>Ranked</h1><p>Rated competitive debates.</p>' +
        '<h2>Planned capabilities</h2>' +
        '<ul><li>Matchmaking</li><li>Season ladders</li></ul></section>',
    });
  });
});
