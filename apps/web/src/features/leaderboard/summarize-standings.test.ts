import type { StandingsRead } from '@daisy/db';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { summarizeStandings } from './summarize-standings';

setupRitewayBun();

const posting = (
  actorId: string,
  debateId: string,
  before: number,
  after: number,
  occurredAt: string,
  role: 'affirmative' | 'negative',
  outcome: 'affirmative' | 'negative' | 'draw',
) => ({
  seasonId: 's1',
  actorId,
  debateId,
  ratingBefore: before,
  ratingAfter: after,
  occurredAt,
  role,
  outcome,
});

const read: StandingsRead = {
  ratings: [
    {
      seasonId: 's1',
      actorId: 'ada',
      username: 'ada',
      rating: 1530,
      deviation: 250,
    },
    {
      seasonId: 's1',
      actorId: 'bo',
      username: null,
      rating: 1470,
      deviation: 250,
    },
    {
      seasonId: 's1',
      actorId: 'cy',
      username: 'cy',
      rating: 1500,
      deviation: 350,
    },
  ],
  changes: [
    posting(
      'ada',
      'd1',
      1500,
      1516,
      '2026-09-20T12:00:00.000Z',
      'affirmative',
      'affirmative',
    ),
    posting(
      'bo',
      'd1',
      1500,
      1484,
      '2026-09-20T12:00:00.000Z',
      'negative',
      'affirmative',
    ),
    posting(
      'ada',
      'd2',
      1516,
      1530,
      '2026-10-04T12:00:00.000Z',
      'negative',
      'negative',
    ),
    posting(
      'bo',
      'd3',
      1484,
      1470,
      '2026-10-05T12:00:00.000Z',
      'affirmative',
      'draw',
    ),
  ],
};

describe('summarizeStandings', () => {
  test('derives record and movement from the ledger', () => {
    assert({
      given: 'two rated debaters and one with a rating but no postings',
      should:
        'count wins, losses and draws by seat and outcome, sum the week and season movement, and keep the last posting',
      actual: summarizeStandings(read, '2026-09-28T12:00:00.000Z'),
      expected: [
        {
          seasonId: 's1',
          actorId: 'ada',
          username: 'ada',
          rating: 1530,
          deviation: 250,
          played: 2,
          wins: 2,
          losses: 0,
          draws: 0,
          weekChange: 14,
          seasonChange: 30,
          lastRatedAt: '2026-10-04T12:00:00.000Z',
        },
        {
          seasonId: 's1',
          actorId: 'bo',
          username: null,
          rating: 1470,
          deviation: 250,
          played: 2,
          wins: 0,
          losses: 1,
          draws: 1,
          weekChange: -14,
          seasonChange: -30,
          lastRatedAt: '2026-10-05T12:00:00.000Z',
        },
        {
          seasonId: 's1',
          actorId: 'cy',
          username: 'cy',
          rating: 1500,
          deviation: 350,
          played: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          weekChange: 0,
          seasonChange: 0,
          lastRatedAt: null,
        },
      ],
    });
  });

  test('keeps each season apart', () => {
    const twoSeasons: StandingsRead = {
      ratings: [
        {
          seasonId: 's1',
          actorId: 'ada',
          username: 'ada',
          rating: 1516,
          deviation: 290,
        },
        {
          seasonId: 's0',
          actorId: 'ada',
          username: 'ada',
          rating: 1700,
          deviation: 80,
        },
      ],
      changes: [
        posting(
          'ada',
          'd1',
          1500,
          1516,
          '2026-10-05T12:00:00.000Z',
          'affirmative',
          'affirmative',
        ),
        {
          ...posting(
            'ada',
            'd0',
            1690,
            1700,
            '2026-06-01T12:00:00.000Z',
            'affirmative',
            'affirmative',
          ),
          seasonId: 's0',
        },
      ],
    };
    assert({
      given: 'one debater rated in two seasons',
      should: 'summarise each season from its own postings',
      actual: summarizeStandings(twoSeasons, '2026-09-28T12:00:00.000Z').map(
        ({ seasonId, played, seasonChange }) => [
          seasonId,
          played,
          seasonChange,
        ],
      ),
      expected: [
        ['s1', 1, 16],
        ['s0', 1, 10],
      ],
    });
  });

  test('counts a posting exactly at the week boundary', () => {
    const boundary = '2026-10-01T00:00:00.000Z';
    const read: StandingsRead = {
      ratings: [
        {
          seasonId: 's1',
          actorId: 'ada',
          username: 'ada',
          rating: 1516,
          deviation: 290,
        },
      ],
      changes: [
        posting(
          'ada',
          'd1',
          1500,
          1516,
          boundary,
          'affirmative',
          'affirmative',
        ),
      ],
    };
    assert({
      given: 'a posting at exactly the start of the week',
      should: 'count it in the week change',
      actual: summarizeStandings(read, boundary)[0]?.weekChange,
      expected: 16,
    });
  });
});
