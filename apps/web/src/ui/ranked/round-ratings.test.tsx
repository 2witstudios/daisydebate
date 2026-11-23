import { ladderCopyInView } from '../test-support/ladder-copy.test-support';
import {
  renderAccessible,
  type AccessibleView,
} from '../../test-support/rendered/accessible';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoundRatingsView } from '../../features/ratings/read-round';
import {
  changeToneClass,
  ladderChangeText,
  RoundRatings,
  signedChange,
} from './round-ratings';

setupRitewayBun();

const youth = { style: 'freestyle', division: 'youth' } as const;

const row = {
  label: 'maya.okafor',
  rating: 1526,
  provisional: false,
  delta: 14,
  win: 14,
  loss: -12,
};

const render = (view: Partial<RoundRatingsView>) =>
  renderAccessible(
    <RoundRatings
      view={{
        ladder: youth,
        season: 'Fall 2026',
        rows: [],
        posting: 'none',
        ...view,
      }}
    />,
  );

/** Whether one of the receipt's figures reads exactly this text. */
const shows = (view: AccessibleView, text: string) =>
  view.all('definition').some((element) => element.textContent === text);

test('the receipt says whether the ladder rated the Round', () => {
  const says = (posting: 'rated' | 'pending' | 'none') => {
    const view = render({ posting });
    return {
      rated: view.all('paragraph').some((p) => p.textContent === 'Rated'),
      pending: view.textContent().includes('Rating update pending'),
    };
  };
  assert({
    given: 'a posted Round, one still owed a rating and an unrated one',
    should: 'say Rated, then pending, then neither',
    actual: [says('rated'), says('pending'), says('none')],
    expected: [
      { rated: true, pending: false },
      { rated: false, pending: true },
      { rated: false, pending: false },
    ],
  });
});

describe('the ladder a Round rated', () => {
  test('heading and rows', () => {
    const view = render({
      posting: 'rated',
      rows: [
        row,
        {
          ...row,
          label: 'jules_park',
          rating: 1466,
          provisional: true,
          delta: -12,
          win: 16,
        },
      ],
    });
    assert({
      given: 'a rated Youth Round with a gain and a provisional loss',
      should:
        'head with the ladder and season, and name the ladder on each change',
      actual: [
        view.has('heading', 'Ranked · Fall 2026', { level: 2 }) &&
          ladderCopyInView(view) === null,
        shows(view, '1526 +14'),
        shows(view, '1466* −12'),
        view.textContent().includes('Win +14 · Loss −12'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('the text a reader meets, as YRoundResult words it', () => {
    const text = render({
      posting: 'rated',
      rows: [{ ...row, rating: 1662, provisional: true, delta: 162 }],
    }).textContent();
    assert({
      given: 'a provisional youth debater who gained 162',
      should:
        'read the rating, then the change, naming no ladder: "1662* +162"',
      actual: text.includes('1662* +162'),
      expected: true,
    });
  });

  test('change words', () => {
    assert({
      given: 'a gain, a loss and no change',
      should: 'sign each with a true minus, name the ladder and tone it',
      actual: [
        [signedChange(14), signedChange(-12), signedChange(0)],
        ladderChangeText(-3),
        [changeToneClass(1), changeToneClass(-1), changeToneClass(0)],
      ],
      expected: [
        ['+14', '−12', '0'],
        '−3',
        ['text-online', 'text-hue-clay', 'text-ink-muted'],
      ],
    });
  });
});
