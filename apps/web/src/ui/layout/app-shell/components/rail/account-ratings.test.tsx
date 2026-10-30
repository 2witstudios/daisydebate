import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { MemberStanding } from '../../../../../features/ratings/read-member';
import { AccountRatings, RatingsSkeleton, ratingText } from './account-ratings';

setupRitewayBun();

const standing = (overrides: Partial<MemberStanding>): MemberStanding => ({
  ladder: 'freestyle',
  season: 'Autumn 2026',
  rating: 1512,
  provisional: false,
  hidden: false,
  ...overrides,
});

const render = async (
  ratings: Parameters<typeof AccountRatings>[0]['ratings'],
) => renderToString(await AccountRatings({ ratings }));

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
      expected: [
        '1512',
        '1512 · Provisional',
        'Unrated',
        'Hidden while judging',
      ],
    });
  });
});

describe('AccountRatings', () => {
  test('lists each ladder with its season and rating, in the order the shell read them', async () => {
    const html = await render(
      Promise.resolve({
        state: 'ready',
        standings: [
          standing({ ladder: 'freestyle', rating: 1512 }),
          standing({ ladder: 'policy', rating: null }),
          standing({ ladder: 'value', rating: 1530, provisional: true }),
        ],
      }),
    );
    assert({
      given: 'a member with a rating on each ladder',
      should:
        'title the section with the season and name each ladder with its rating state',
      actual: [
        html.includes('Ranked · Autumn 2026'),
        html.includes('Freestyle'),
        html.includes('1512'),
        html.includes('Unrated'),
        html.includes('1530 · Provisional'),
        html.indexOf('Freestyle') < html.indexOf('Policy'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('says no season is active when none is read, and that ratings are unavailable when the read failed', async () => {
    const none = await render(
      Promise.resolve({ state: 'ready', standings: [] }),
    );
    const failed = await render(Promise.resolve({ state: 'unavailable' }));
    assert({
      given: 'a read with no standings and a failed read',
      should:
        'say no season is active, and say ratings are unavailable right now, without a blank section',
      actual: [
        none.includes('No season is active.'),
        failed.includes('Ratings are unavailable right now.'),
      ],
      expected: [true, true],
    });
  });

  test('the skeleton names the section and says it is loading, with no ratings in it', () => {
    const html = renderToString(h(RatingsSkeleton));
    assert({
      given: 'a rating still being read',
      should: 'mark the section busy and tell screen readers it is loading',
      actual: [
        html.includes('aria-busy="true"'),
        html.includes('Loading your ratings'),
        html.includes('Unrated'),
      ],
      expected: [true, true, false],
    });
  });
});
