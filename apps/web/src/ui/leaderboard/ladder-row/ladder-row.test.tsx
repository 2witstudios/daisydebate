import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { LadderRow } from './ladder-row';
import { rowFixture } from '../../../features/leaderboard/ladder.test-support';
import {
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';

setupRitewayBun();

const render = (props: Parameters<typeof rowFixture>[0], closed = false) =>
  renderAccessible(h(LadderRow, { row: rowFixture(props), closed }));

/** Whether a piece of the row reads exactly this text. */
const shows = (
  view: AccessibleView,
  text: string,
  states: { hidden?: boolean } = {},
) =>
  view
    .all('generic', undefined, states)
    .some((element) => element.textContent === text);

describe('LadderRow', () => {
  test('an established row is one link', () => {
    const view = render({ change: { kind: 'up', amount: 3 } });
    const text = view.textContent();
    assert({
      given: 'an established debater',
      should:
        'be one link named with rank and rating, showing record and move and no band',
      actual: [
        view.count('link'),
        view.attribute('link', '@ada, rank 4, rating 1650', 'href'),
        text.includes('Full bloom'),
        text.includes('12–5'),
        text.includes('▲ 3'),
        shows(view, 'You'),
      ],
      expected: [1, '/leaderboard?debater=ada', false, true, true, false],
    });
  });

  test('the viewer’s own row', () => {
    const view = render({ me: true, selected: true });
    assert({
      given: 'the viewer’s row with its detail open',
      should: 'carry a You badge and mark the current link',
      actual: [
        shows(view, 'You'),
        view.has('link', '@ada, rank 4, rating 1650', { current: true }),
      ],
      expected: [true, true],
    });
  });

  test('provisional', () => {
    const view = render({
      provisional: true,
      rank: null,
      rating: 1412,
    });
    assert({
      given: 'a provisional debater',
      should:
        'show a dash for rank and a starred rating, and say Provisional in the hover card',
      actual: [
        shows(view, '–'),
        shows(view, '1412*'),
        shows(view, 'Provisional', { hidden: true }),
      ],
      expected: [true, true, true],
    });
  });

  test('a closed account', () => {
    const text = render({ accountClosed: true }).textContent();
    assert({
      given: 'a closed account',
      should: 'show its name marked closed and keep the rating',
      actual: [text.includes('@ada (closed)'), text.includes('1650')],
      expected: [true, true],
    });
  });

  test('a debater the viewer is judging', () => {
    const view = render({
      masked: true,
      rank: null,
      rating: 0,
    });
    const text = view.textContent();
    assert({
      given: 'a masked row',
      should: 'say Hidden, and show no rating, record or hover card',
      actual: [
        text.includes('Hidden'),
        shows(view, '0', { hidden: true }),
        text.includes('12–5'),
        text.includes('Enter opens the full detail'),
      ],
      expected: [true, false, false, false],
    });
  });

  test('a closed season', () => {
    const view = render({ change: { kind: 'down', amount: 8 } }, true);
    assert({
      given: 'a closed season',
      should: 'show the signed season change',
      actual: view.textContent().includes('−8'),
      expected: true,
    });
  });

  test('hover card', () => {
    const view = render({});
    assert({
      given: 'a row with a username',
      should: 'carry a hover card that is hidden from assistive tech',
      actual: [
        shows(view, '±120 · #4', { hidden: true }),
        shows(view, '±120 · #4'),
      ],
      expected: [true, false],
    });
  });
});
