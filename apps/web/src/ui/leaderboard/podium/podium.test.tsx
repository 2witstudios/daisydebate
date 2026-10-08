import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { rowFixture } from '../../../features/leaderboard/ladder.test-support';
import { Podium } from './podium';

setupRitewayBun();

describe('Podium', () => {
  test('three cards, each a link', () => {
    const html = renderToString(
      h(Podium, {
        closed: false,
        rows: [
          rowFixture({ key: 'a', username: 'ada', rank: 1, rating: 1716 }),
          rowFixture({ key: 'b', username: 'bob', rank: 2, rating: 1700 }),
          rowFixture({ key: 'c', username: 'cy', rank: 3, rating: 1690 }),
        ],
      }),
    );
    assert({
      given: 'three rows',
      should:
        'list three linked cards with the first in gold border, each giving its W–L record with no tier label or glyph',
      actual: [
        html.includes('aria-label="Top three"'),
        html.match(/<a /g)?.length,
        html.match(/border-gold-border/g)?.length,
        html.includes('aria-label="@ada, rank 1, rating 1716"'),
        html.includes('▲ 3'),
        html.match(/<span[^>]*>\d+–\d+ W–L<\/span>/g)?.length,
        html.includes('<svg'),
      ],
      expected: [true, 3, 1, true, false, 3, false],
    });
  });

  test('movement in a live season', () => {
    const html = renderToString(
      h(Podium, {
        closed: false,
        rows: [rowFixture({ change: { kind: 'up', amount: 3 } })],
      }),
    );
    assert({
      given: 'a row that rose three places this week',
      should: 'show the arrow and amount',
      actual: html.includes('▲ 3'),
      expected: true,
    });
  });
});
