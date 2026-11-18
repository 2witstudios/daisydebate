import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
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
      expected: ['1526', '1526*', 'Unrated', 'Hidden while judging'],
    });
  });
});

describe('railLadderRows', () => {
  test('the member’s own ladder first with its rating; the other locked to its audience', () => {
    const standings = [openStanding(), standing({})];
    assert({
      given: 'a youth member, then an adult, on both Freestyle ladders',
      should:
        'rate Youth and lock Open to 18 and over, then rate Open and lock Youth to Under 18',
      actual: [
        railLadderRows(standings, 'youth').map((row) =>
          row.kind === 'own'
            ? [row.ladder.division, row.text]
            : [row.ladder.division, row.audience],
        ),
        railLadderRows(standings, 'open').map((row) =>
          row.kind === 'own'
            ? [row.ladder.division, row.text]
            : [row.ladder.division, row.audience],
        ),
      ],
      expected: [
        [
          ['youth', '1526'],
          ['open', '18 and over'],
        ],
        [
          ['open', 'Unrated'],
          ['youth', 'Under 18'],
        ],
      ],
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
      actual: row?.kind === 'own' ? row.text : null,
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
  test('a youth member sees Youth rated and Open locked 18 and over', async () => {
    const html = await render(
      Promise.resolve({
        state: 'ready',
        division: 'youth',
        standings: [
          openStanding(),
          standing({ rating: 1530, provisional: true }),
        ],
      }),
    );
    assert({
      given: 'a youth member rated provisionally on Youth – Freestyle',
      should:
        'title the section with the season, rate Youth starred and italic, and lock Open',
      actual: [
        html.includes('Ranked · Fall 2026'),
        html.indexOf('Youth – Freestyle') < html.indexOf('Open – Freestyle'),
        html.includes('1530*'),
        html.includes('title="Provisional rating"'),
        html.includes('18 and over'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('says no season is active, that ranked needs an age, and that ratings are unavailable when the read failed', async () => {
    const none = await render(
      Promise.resolve({ state: 'ready', division: 'open', standings: [] }),
    );
    const noAge = await render(
      Promise.resolve({
        state: 'ready',
        division: null,
        standings: [openStanding(), standing({})],
      }),
    );
    const failed = await render(Promise.resolve({ state: 'unavailable' }));
    assert({
      given:
        'a read with no standings, a member with no ladder, and a failed read',
      should: 'say each plainly, without a blank section',
      actual: [
        none.includes('No season is active.'),
        noAge.includes(noLadderReason.replaceAll("'", '&#x27;')),
        failed.includes('Ratings are unavailable right now.'),
      ],
      expected: [true, true, true],
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
