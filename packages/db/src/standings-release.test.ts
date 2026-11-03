import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { releasedStandings } from './standings-release';

setupRitewayBun();

const rating = {
  seasonId: 's',
  actorId: 'a',
  username: 'ana',
  accountClosed: false,
  rating: 1600,
  deviation: 90,
  volatility: 0.07,
};
const posting = (over: {
  readonly roundId: string;
  readonly occurredAt: string;
  readonly released: boolean;
  readonly ratingBefore: number;
  readonly ratingAfter: number;
}) => ({
  seasonId: 's',
  actorId: 'a',
  deviationBefore: over.ratingBefore / 10,
  deviationAfter: 90,
  volatilityBefore: 0.06,
  role: 'affirmative' as const,
  outcome: 'affirmative' as const,
  ...over,
});
const first = posting({
  roundId: 'r1',
  occurredAt: '2026-11-02T00:00:00.000Z',
  released: true,
  ratingBefore: 1500,
  ratingAfter: 1550,
});
const second = posting({
  roundId: 'r2',
  occurredAt: '2026-11-02T00:10:00.000Z',
  released: false,
  ratingBefore: 1550,
  ratingAfter: 1600,
});
const third = posting({
  roundId: 'r3',
  occurredAt: '2026-11-02T00:20:00.000Z',
  released: false,
  ratingBefore: 1600,
  ratingAfter: 1650,
});
const publicFirst = {
  seasonId: first.seasonId,
  actorId: first.actorId,
  roundId: first.roundId,
  ratingBefore: first.ratingBefore,
  ratingAfter: first.ratingAfter,
  deviationBefore: first.deviationBefore,
  deviationAfter: first.deviationAfter,
  occurredAt: first.occurredAt,
  role: first.role,
  outcome: first.outcome,
};

describe('releasedStandings', () => {
  test('every posting released: the stored rating stands', () => {
    const read = releasedStandings({ ratings: [rating], changes: [first] });
    assert({
      given: 'a debater with only released postings',
      should: 'keep the rating and the posting as stored',
      actual: read,
      expected: { ratings: [rating], changes: [publicFirst] },
    });
  });

  test('an unreleased posting never reaches the read', () => {
    const read = releasedStandings({
      ratings: [rating],
      changes: [third, first, second],
    });
    assert({
      given: 'two unreleased postings after a released one',
      should: 'rewind to before the earliest unreleased and drop both',
      actual: read,
      expected: {
        ratings: [
          { ...rating, rating: 1550, deviation: 155, volatility: 0.06 },
        ],
        changes: [publicFirst],
      },
    });
  });

  test('a first posting unreleased: the debater is not on the ladder yet', () => {
    assert({
      given: 'a debater whose only posting is unreleased',
      should: 'show no rating at all',
      actual: releasedStandings({ ratings: [rating], changes: [second] }),
      expected: { ratings: [], changes: [] },
    });
  });
});
