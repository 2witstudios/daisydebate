import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { rowFixture } from '../../../features/leaderboard/ladder.test-support';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { Podium } from './podium';

setupRitewayBun();

describe('Podium', () => {
  test('three cards, each a link', () => {
    const view = renderAccessible(
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
        'list three linked cards, each giving its W–L record with no tier label',
      actual: [
        view.within('list', 'Top three').count('link'),
        view.count('link'),
        view.has('link', '@ada, rank 1, rating 1716'),
        view.textContent().includes('▲ 3'),
        view
          .all('generic')
          .filter((element) => /^\d+–\d+ W–L$/.test(element.textContent ?? ''))
          .length,
      ],
      expected: [3, 3, true, false, 3],
    });
  });

  test('movement in a live season', () => {
    const view = renderAccessible(
      h(Podium, {
        closed: false,
        rows: [rowFixture({ change: { kind: 'up', amount: 3 } })],
      }),
    );
    assert({
      given: 'a row that rose three places this week',
      should: 'show the arrow and amount',
      actual: view.textContent().includes('▲ 3'),
      expected: true,
    });
  });
});
