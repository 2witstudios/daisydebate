import { ladderCopyIn } from '../test-support/ladder-copy.test-support';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { MemberStanding } from '../../features/ratings/read-member';
import { MemberStandings, seasonHistoryFacts } from './member-standings';

setupRitewayBun();

const standing = (over: Partial<MemberStanding>): MemberStanding => ({
  ladder: { style: 'freestyle', division: 'open' },
  key: 'freestyle:open',
  season: 'Fall 2026',
  current: true,
  rating: 1500,
  provisional: true,
  hidden: false,
  ...over,
});

describe('MemberStandings', () => {
  test('a member who turned 18: one Rating card, then every season (YProfile, generic copy)', () => {
    const html = renderToString(
      <MemberStandings
        standings={[standing({})]}
        seasonHistory={[
          {
            key: 'freestyle:youth:s1',
            ladder: { style: 'freestyle', division: 'youth' },
            season: 'Spring 2026',
            rating: 1604,
            provisional: false,
            rank: 12,
            of: 388,
            wins: 31,
            losses: 12,
          },
        ]}
      />,
    );
    assert({
      given: 'a provisional rating now and a Youth season finished before',
      should:
        'show one Freestyle card, then the season with its facts, naming no division',
      actual: [
        html.includes('>Rating</a>'),
        html.includes('Fall 2026 · current'),
        html.includes('1500*'),
        html.includes('>Provisional<'),
        html.includes('Season history'),
        html.includes('#12 of 388 · 31–12'),
        ladderCopyIn(html) ?? (html.includes('Youth') || html.includes('Open')),
        html.includes('text-hue-plum'),
      ],
      expected: [true, true, true, true, true, true, false, false],
    });
  });

  test('a member with no ladder card says Unrated', () => {
    const html = renderToString(<MemberStandings standings={[]} />);
    assert({
      given: 'someone else who never played a ranked Round',
      should: 'say Unrated, with no Season history',
      actual: [html.includes('>Unrated<'), html.includes('Season history')],
      expected: [true, false],
    });
  });
});

describe('seasonHistoryFacts', () => {
  test('rank shows only once established', () => {
    const row = {
      key: 'k',
      ladder: { style: 'freestyle', division: 'youth' },
      season: 'Fall 2025',
      rating: 1541,
      provisional: false,
      rank: null,
      of: 350,
      wins: 19,
      losses: 11,
    } as const;
    assert({
      given: 'a provisional season and a ranked one',
      should: 'show only the record, then the rank and record',
      actual: [
        seasonHistoryFacts(row),
        seasonHistoryFacts({ ...row, rank: 41 }),
      ],
      expected: ['19–11', '#41 of 350 · 19–11'],
    });
  });
});
