import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { rowFixture } from '../features/leaderboard/ladder.test-support';
import { renderMarkup } from '../test-support/rendered/markup';
import { Podium } from '../ui/leaderboard/podium/podium';

setupRitewayBun();

/**
 * The podium's gold first card and the absence of a tier glyph are visual
 * contracts with no role, name or state.
 */
describe('Podium markup', () => {
  test('three cards', () => {
    const html = renderMarkup(
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
      should: 'border only the first in gold, with no tier glyph',
      actual: [
        html.match(/border-gold-border/g)?.length,
        html.includes('<svg'),
      ],
      expected: [1, false],
    });
  });
});
