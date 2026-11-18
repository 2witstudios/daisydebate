import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { MemberStanding } from '../../features/ratings/read-member';
import { playCaption } from './home-ladder';

setupRitewayBun();

const youth = (over: Partial<MemberStanding> = {}): MemberStanding => ({
  ladder: { style: 'freestyle', division: 'youth' },
  key: 'freestyle:youth',
  season: 'Fall 2026',
  current: true,
  rating: 1526,
  provisional: false,
  hidden: false,
  ...over,
});

describe('playCaption', () => {
  test('the member’s ladder and this season’s rating', () => {
    assert({
      given:
        'a youth member rated 1526, one rated only last season, one judged, and no ladder',
      should:
        'name the style with its rating, the style alone twice, then nothing; never a division',
      actual: [
        playCaption([youth()], 'youth'),
        playCaption([youth({ current: false })], 'youth'),
        playCaption([youth({ hidden: true })], 'youth'),
        playCaption([youth()], null),
      ],
      expected: ['Freestyle · 1526', 'Freestyle', 'Freestyle', null],
    });
  });
});
