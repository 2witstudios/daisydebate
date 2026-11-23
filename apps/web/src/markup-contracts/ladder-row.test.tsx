import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { rowFixture } from '../features/leaderboard/ladder.test-support';
import { renderMarkup } from '../test-support/rendered/markup';
import { LadderRow } from '../ui/leaderboard/ladder-row/ladder-row';

setupRitewayBun();

const render = (props: Parameters<typeof rowFixture>[0]) =>
  renderMarkup(h(LadderRow, { row: rowFixture(props), closed: false }));

/**
 * The ladder row's visual contracts that carry no role, name or state: the
 * italic provisional figure, the absent tier marker and name icon, and the
 * hover card's reveal on hover and focus.
 */
describe('LadderRow markup', () => {
  test('provisional', () => {
    const html = render({ provisional: true, rank: null, rating: 1412 });
    assert({
      given: 'a provisional debater',
      should: 'set the rating italic, with no tier marker',
      actual: [html.includes('italic'), html.includes('stroke-dasharray')],
      expected: [true, false],
    });
  });

  test('a debater the viewer is judging', () => {
    const html = render({ masked: true, rank: null, rating: 0 });
    assert({
      given: 'a masked row',
      should: 'start the name with no icon so it lines up with every other row',
      actual: html.includes('<svg'),
      expected: false,
    });
  });

  test('hover card', () => {
    const html = render({});
    assert({
      given: 'a row with a username',
      should: 'reveal its hover card on hover and on focus',
      actual: [
        html.includes('group-hover:visible'),
        html.includes('group-focus-within:visible'),
      ],
      expected: [true, true],
    });
  });
});
