import { renderToString } from 'react-dom/server';
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
  renderToString(
    <RoundRatings
      view={{
        ladder: youth,
        season: 'Fall 2026',
        rows: [],
        posting: 'none',
        ...view,
      }}
    />,
  ).replace(/<!-- -->/g, '');

test('the receipt says whether the ladder rated the Round', () => {
  const says = (posting: 'rated' | 'pending' | 'none') => {
    const html = render({ posting });
    return {
      rated: html.includes('<p>Rated</p>'),
      pending: html.includes('Rating update pending'),
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
    const html = render({
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
        /<h2[^>]*><span[^>]*text-hue-plum[^>]*>Youth – Freestyle<\/span> · Fall 2026<\/h2>/.test(
          html,
        ),
        html.includes(
          '1526<span class="font-body text-base font-book not-italic text-online"> Youth – Freestyle +14</span>',
        ),
        html.includes(
          '1466*<span class="font-body text-base font-book not-italic text-hue-clay"> Youth – Freestyle −12</span>',
        ),
        html.includes('Win +14 · Loss −12'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('the text a reader meets, as YRoundResult words it', () => {
    const text = render({
      posting: 'rated',
      rows: [{ ...row, rating: 1662, provisional: true, delta: 162 }],
    })
      .replace(/<[^>]+>/g, '')
      .replace(/&#x27;/g, "'");
    assert({
      given: 'a provisional debater who gained 162 on Youth – Freestyle',
      should:
        'read the rating, then the ladder it moved on with the change: "1662* Youth – Freestyle +162"',
      actual: text.includes('1662* Youth – Freestyle +162'),
      expected: true,
    });
  });

  test('change words', () => {
    assert({
      given: 'a gain, a loss and no change',
      should: 'sign each with a true minus, name the ladder and tone it',
      actual: [
        [signedChange(14), signedChange(-12), signedChange(0)],
        ladderChangeText({ style: 'freestyle', division: 'open' }, -3),
        [changeToneClass(1), changeToneClass(-1), changeToneClass(0)],
      ],
      expected: [
        ['+14', '−12', '0'],
        'Open – Freestyle −3',
        ['text-online', 'text-hue-clay', 'text-ink-muted'],
      ],
    });
  });
});
