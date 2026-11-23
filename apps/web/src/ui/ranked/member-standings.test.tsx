import { ladderCopyInView } from '../test-support/ladder-copy.test-support';
import {
  renderAccessible,
  type AccessibleView,
} from '../../test-support/rendered/accessible';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { MemberStanding } from '../../features/ratings/read-member';
import { MemberStandings, seasonHistoryFacts } from './member-standings';

setupRitewayBun();

/** Whether a piece of the card (a span or a paragraph) reads exactly this text. */
const shows = (view: AccessibleView, text: string) =>
  [...view.all('generic'), ...view.all('paragraph')].some(
    (element) => element.textContent === text,
  );

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
    const view = renderAccessible(
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
    const text = view.textContent();
    assert({
      given: 'a provisional rating now and a Youth season finished before',
      should:
        'show one Freestyle card, then the season with its facts, naming no division',
      actual: [
        view.has('link', 'Rating'),
        text.includes('Fall 2026 · current'),
        text.includes('1500*'),
        shows(view, 'Provisional'),
        text.includes('Season history'),
        text.includes('#12 of 388 · 31–12'),
        ladderCopyInView(view) ??
          (text.includes('Youth') || text.includes('Open')),
      ],
      expected: [true, true, true, true, true, true, false],
    });
  });

  test('a member with no ladder card says Unrated', () => {
    const view = renderAccessible(<MemberStandings standings={[]} />);
    assert({
      given: 'someone else who never played a ranked Round',
      should: 'say Unrated, with no Season history',
      actual: [
        shows(view, 'Unrated'),
        view.textContent().includes('Season history'),
      ],
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
