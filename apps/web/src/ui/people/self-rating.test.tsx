import { ladderCopyInView } from '../test-support/ladder-copy.test-support';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
import type { MemberStanding } from '../../features/ratings/read-member';
import {
  HeadlineRating,
  headlineRating,
  railLadderRows,
  ratingText,
} from './self-rating';

setupRitewayBun();

const standing = (overrides: Partial<MemberStanding>): MemberStanding => ({
  ladder: { style: 'freestyle', division: 'youth' },
  key: 'freestyle:youth',
  season: 'Fall 2026',
  current: true,
  rating: 1526,
  provisional: false,
  hidden: false,
  ...overrides,
});
const openStanding = (overrides: Partial<MemberStanding> = {}) =>
  standing({
    ladder: { style: 'freestyle', division: 'open' },
    key: 'freestyle:open',
    rating: null,
    ...overrides,
  });

const render = async (
  ratings: Parameters<typeof HeadlineRating>[0]['ratings'],
) => renderAccessible(h('p', null, await HeadlineRating({ ratings })));

describe('ratingText', () => {
  test('shows the rating, its provisional state, unrated and hidden', () => {
    assert({
      given: 'a standing on each state of the ladder',
      should:
        'show the number, a provisional mark, Unrated for no rating, and Hidden while judging for a blinded rating',
      actual: [
        ratingText(standing({})),
        ratingText(standing({ provisional: true })),
        ratingText(standing({ rating: null })),
        ratingText(standing({ hidden: true })),
      ],
      expected: ['1526', '1526*', 'Unrated', 'Hidden while judging'],
    });
  });
});

describe('railLadderRows', () => {
  test('only the member’s own ladder, never the other lobby’s', () => {
    const standings = [openStanding(), standing({})];
    assert({
      given: 'a youth member, then an adult, on both Freestyle ladders',
      should: 'show one row each: their own ladder and its rating',
      actual: [
        railLadderRows(standings, 'youth').map((row) => [
          row.ladder.division,
          row.text,
        ]),
        railLadderRows(standings, 'open').map((row) => [
          row.ladder.division,
          row.text,
        ]),
      ],
      expected: [[['youth', '1526']], [['open', 'Unrated']]],
    });
  });
  test('a rating kept from an earlier season is no rating this season', () => {
    const [row] = railLadderRows(
      [standing({ current: false, season: 'Spring 2026', rating: 1604 })],
      'youth',
    );
    assert({
      given: 'their own ladder with only last season’s rating',
      should: 'read Unrated',
      actual: row?.text,
      expected: 'Unrated',
    });
  });
});

describe('headlineRating', () => {
  test('your own ladder’s row, and none without a source', () => {
    assert({
      given:
        'a youth member on both ladders, no season, no ladder, and a failed read',
      should: 'give their own ladder’s rating, and nothing for the rest',
      actual: [
        headlineRating({
          state: 'ready',
          division: 'youth',
          standings: [openStanding(), standing({})],
        })?.text,
        headlineRating({ state: 'ready', division: 'open', standings: [] }),
        headlineRating({
          state: 'ready',
          division: null,
          standings: [standing({})],
        }),
        headlineRating({ state: 'unavailable' }),
      ],
      expected: ['1526', null, null, null],
    });
  });
});

describe('HeadlineRating', () => {
  test('one rating, naming no ladder, style or division (YHomeActive)', async () => {
    const view = await render(
      Promise.resolve({
        state: 'ready',
        division: 'youth',
        standings: [
          openStanding(),
          standing({ rating: 1530, provisional: true }),
        ],
      }),
    );
    const text = view.textContent();
    assert({
      given: 'a youth member rated provisionally on their own ladder',
      should:
        'show the rating starred, named as a rating to screen readers, and name no ladder, style or division',
      actual: [
        text.includes('1530*'),
        text.includes('rating'),
        ladderCopyInView(view) ??
          ['Youth', 'Open', 'Freestyle'].some((word) => text.includes(word)),
      ],
      expected: [true, true, false],
    });
  });

  test('shows nothing when there is no rating to show', async () => {
    const failed = await HeadlineRating({
      ratings: Promise.resolve({ state: 'unavailable' }),
    });
    assert({
      given: 'a failed ratings read',
      should: 'render nothing rather than a guess',
      actual: failed,
      expected: null,
    });
  });
});
