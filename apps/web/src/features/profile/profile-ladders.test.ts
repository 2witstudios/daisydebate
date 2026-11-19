import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { MemberStanding } from '../ratings/read-member';
import { currentDivisionOf, profileLadders } from './profile-ladders';

setupRitewayBun();

const standing = (
  division: MemberStanding['ladder']['division'],
  over: Partial<MemberStanding> = {},
): MemberStanding => ({
  ladder: { style: 'freestyle', division },
  key: `freestyle:${division}`,
  season: 'Fall 2026',
  current: true,
  rating: null,
  provisional: false,
  hidden: false,
  ...over,
});

describe('profileLadders', () => {
  test('a member who turned 18: one card, this season’s', () => {
    const shown = profileLadders(
      [
        standing('youth', {
          current: false,
          rating: 1604,
          season: 'Spring 2026',
        }),
        standing('open', { rating: 1500, provisional: true }),
      ],
      null,
    );
    assert({
      given: 'a Youth rating from last season and a provisional Open one now',
      should: 'show only the current card; earlier seasons are history rows',
      actual: shown.map((s) => [s.ladder.division, s.current]),
      expected: [['open', true]],
    });
  });
  test('an unrated ladder shows only when it is the member’s own', () => {
    const unrated = [standing('open'), standing('youth')];
    assert({
      given: 'a youth member unrated everywhere, and someone else unrated',
      should: 'show their own Youth card only, and nothing for the other',
      actual: [
        profileLadders(unrated, 'youth').map((s) => s.ladder.division),
        profileLadders(unrated, null),
      ],
      expected: [['youth'], []],
    });
  });
});

describe('currentDivisionOf', () => {
  test('the one ladder rated this season', () => {
    assert({
      given:
        'a current Open rating beside Youth history, no rating, and ratings on both',
      should: 'name Open, then unknown twice',
      actual: [
        currentDivisionOf([
          standing('open', { rating: 1500 }),
          standing('youth', { current: false, rating: 1604 }),
        ]),
        currentDivisionOf([standing('open'), standing('youth')]),
        currentDivisionOf([
          standing('open', { rating: 1500 }),
          standing('youth', { rating: 1500 }),
        ]),
      ],
      expected: ['open', null, null],
    });
  });
});
