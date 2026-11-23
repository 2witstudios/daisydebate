import { ladderCopyInView } from '../../../../test-support/ladder-copy.test-support';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../../../test-support/rendered/accessible';
import { noLadderReason } from '../../../../../features/play/ladder-division-words';
import type { MemberStanding } from '../../../../../features/ratings/read-member';
import {
  AccountRatings,
  railLadderRows,
  railSeason,
  RatingsSkeleton,
  ratingText,
} from './account-ratings';

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
  ratings: Parameters<typeof AccountRatings>[0]['ratings'],
) => renderAccessible(await AccountRatings({ ratings }));

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

describe('railSeason', () => {
  test('the season of the member’s own current ladder', () => {
    assert({
      given: 'their own ladder kept from last season, beside a current one',
      should: 'name the current season',
      actual: railSeason(
        [
          standing({ current: false, season: 'Spring 2026' }),
          openStanding({ season: 'Fall 2026' }),
        ],
        'youth',
      ),
      expected: 'Fall 2026',
    });
  });
});

describe('AccountRatings', () => {
  test('one Rating, naming no ladder, style or division (YHomeActive)', async () => {
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
        'title the section with the season, show the Rating starred, and name no ladder, style or division',
      actual: [
        view.within('region', 'Ratings').has('heading', 'Ranked · Fall 2026'),
        view.text('term'),
        view.text('definition', 'Provisional rating'),
        ladderCopyInView(view) ??
          ['Youth', 'Open', 'Freestyle'].some((word) => text.includes(word)),
      ],
      expected: [true, 'Rating', '1530*', false],
    });
  });

  test('says no season is active, that ranked needs an age, and that ratings are unavailable when the read failed', async () => {
    const none = (
      await render(
        Promise.resolve({ state: 'ready', division: 'open', standings: [] }),
      )
    ).textContent();
    const noAge = (
      await render(
        Promise.resolve({
          state: 'ready',
          division: null,
          standings: [openStanding(), standing({})],
        }),
      )
    ).textContent();
    const failed = (
      await render(Promise.resolve({ state: 'unavailable' }))
    ).textContent();
    assert({
      given:
        'a read with no standings, a member with no ladder, and a failed read',
      should: 'say each plainly, without a blank section',
      actual: [
        none.includes('No season is active.'),
        noAge.includes(noLadderReason),
        failed.includes('Ratings are unavailable right now.'),
      ],
      expected: [true, true, true],
    });
  });

  test('the skeleton names the section and says it is loading, with no ratings in it', () => {
    const view = renderAccessible(h(RatingsSkeleton));
    assert({
      given: 'a rating still being read',
      should: 'mark the section busy and tell screen readers it is loading',
      actual: [
        view.attribute('region', 'Ratings', 'aria-busy'),
        view.textContent().includes('Loading your ratings'),
        view.textContent().includes('Unrated'),
      ],
      expected: ['true', true, false],
    });
  });
});
