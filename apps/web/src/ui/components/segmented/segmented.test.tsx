import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Segmented } from './segmented';

setupRitewayBun();

describe('Segmented', () => {
  test('links with one current', () => {
    const html = renderToString(
      h(Segmented, {
        label: 'Scope',
        segments: [
          { label: 'Top', href: '/leaderboard', selected: true },
          {
            label: 'Around me',
            href: '/leaderboard?scope=around',
            selected: false,
          },
        ],
      }),
    );
    assert({
      given: 'two segments, the first current',
      should: 'render a labelled nav of links marking only the first current',
      actual: [
        html.includes('aria-label="Scope"'),
        html.match(/<a /g)?.length,
        html.match(/aria-current="page"/g)?.length,
        html.includes('href="/leaderboard?scope=around"'),
      ],
      expected: [true, 2, 1, true],
    });
  });

  test('no label inside the group', () => {
    const html = renderToString(
      h(Segmented, {
        label: 'Lobby',
        segments: [{ label: 'Open lobby', href: '/lobby', selected: true }],
      }),
    );
    assert({
      given: 'a labelled group',
      should: 'name it for assistive technology only, never as visible text',
      actual: [html.includes('aria-label="Lobby"'), html.includes('>Lobby<')],
      expected: [true, false],
    });
  });
  test('the phone fill adds its classes as separate tokens', () => {
    const html = renderToString(
      h(Segmented, {
        label: 'Lobby',
        fillOnPhone: true,
        segments: [{ label: 'Open lobby', href: '/lobby', selected: true }],
      }),
    );
    const tokens = (html.match(/class="([^"]*)"/g) ?? []).flatMap((c) =>
      c.slice(7, -1).split(' '),
    );
    assert({
      given: 'a segmented control that fills a phone',
      should: 'keep its padding and phone classes as whole tokens',
      actual: ['p-1', 'max-narrow:flex', 'max-narrow:flex-1'].every((t) =>
        tokens.includes(t),
      ),
      expected: true,
    });
  });
});
