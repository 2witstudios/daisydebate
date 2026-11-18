import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { MemberStanding } from '../../features/ratings/read-member';
import { leaderboardTagline, playCaption } from './home-ladder';

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
        'name the ladder with its rating, the ladder alone twice, then nothing',
      actual: [
        playCaption([youth()], 'youth'),
        playCaption([youth({ current: false })], 'youth'),
        playCaption([youth({ hidden: true })], 'youth'),
        playCaption([youth()], null),
      ],
      expected: [
        'Youth – Freestyle · 1526',
        'Youth – Freestyle',
        'Youth – Freestyle',
        null,
      ],
    });
  });
});

describe('leaderboardTagline', () => {
  test('every ladder by name, the member’s own first', () => {
    assert({
      given: 'a youth member, an adult, and a visitor',
      should: 'lead with their own ladder, Youth for a visitor',
      actual: [
        leaderboardTagline('youth'),
        leaderboardTagline('open'),
        leaderboardTagline(null),
      ],
      expected: [
        'Youth – Freestyle and Open – Freestyle ladders.',
        'Open – Freestyle and Youth – Freestyle ladders.',
        'Youth – Freestyle and Open – Freestyle ladders.',
      ],
    });
  });
});
