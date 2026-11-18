import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Ladder } from '@daisy/protocol';
import { seasonHistoryOf } from './season-history';

setupRitewayBun();

type Reads = Parameters<typeof seasonHistoryOf>[0];

const season = (
  id: string,
  name: string,
  startsAt: string,
  status: 'active' | 'closed',
) => ({ id, name, startsAt, endsAt: null, status });

const entry = (username: string, rating: number, rank: number | null) => ({
  username,
  rating,
  provisional: rank === null,
  rank,
  wins: 31,
  losses: 12,
});

const read = (
  ladder: Ladder,
  seasons: readonly ReturnType<typeof season>[],
  entriesBySeason: Record<string, readonly ReturnType<typeof entry>[]>,
  blindedUsernames: readonly string[] = [],
): Reads[number] =>
  ({
    ladder,
    read: { seasons, entriesBySeason, blindedUsernames },
  }) as unknown as Reads[number];

const youth: Ladder = { style: 'freestyle', division: 'youth' };
const open: Ladder = { style: 'freestyle', division: 'open' };

describe('seasonHistoryOf', () => {
  const reads = (blinded: readonly string[] = []) => [
    read(
      open,
      [season('o1', 'Fall 2026', '2026-09-01T00:00:00.000Z', 'active')],
      { o1: [entry('sam', 1500, null)] },
      blinded,
    ),
    read(
      youth,
      [
        season('y2', 'Spring 2026', '2026-03-01T00:00:00.000Z', 'closed'),
        season('y1', 'Fall 2025', '2025-09-01T00:00:00.000Z', 'closed'),
        season('y0', 'Spring 2025', '2025-03-01T00:00:00.000Z', 'closed'),
      ],
      {
        y2: [entry('ana', 1700, 1), entry('sam', 1603.6, 2)],
        y1: [entry('sam', 1541, 1)],
        y0: [entry('ana', 1500, 1)],
      },
    ),
  ];
  test('closed seasons the member played, newest first, each naming its ladder', () => {
    assert({
      given:
        'a member on Open this season after two Youth seasons, and a Youth season they missed',
      should:
        'list only the finished Youth seasons, newest first, with rating, rank and field size',
      actual: seasonHistoryOf(reads(), 'sam').map((row) => [
        row.season,
        row.ladder.division,
        row.rating,
        row.rank,
        row.of,
      ]),
      expected: [
        ['Spring 2026', 'youth', 1604, 2, 2],
        ['Fall 2025', 'youth', 1541, 1, 1],
      ],
    });
  });
  test('a member the viewer is judging shows no history', () => {
    assert({
      given: 'a viewer judging the member',
      should: 'show none of their seasons',
      actual: seasonHistoryOf(reads(['sam']), 'sam'),
      expected: [],
    });
  });
});
