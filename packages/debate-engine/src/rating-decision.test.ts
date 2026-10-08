import { assertRejects } from '@daisy/errors/testing';
import type { DebaterStanding, RatingEligibilityFacts } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { rateDebate, ratingPolicy } from './rating';
import { planRating, ratingEligibility } from './rating-decision';

setupRitewayBun();

const at = '2026-10-05T12:00:00.000Z';

const completed: RatingEligibilityFacts = {
  competitionType: 'ranked',
  ladderId: 'ranked',
  status: 'completed',
  outcome: 'affirmative',
  completedAt: at,
  alreadyRated: false,
};

describe('ratingEligibility', () => {
  test('rates a completed ranked round on its frozen ladder', () => {
    assert({
      given: 'a completed ranked round carrying the ranked ladder',
      should: 'rate it on that ladder with its outcome and completion',
      actual: ratingEligibility(completed),
      expected: {
        kind: 'rated',
        ladder: 'ranked',
        outcome: 'affirmative',
        occurredAt: at,
      },
    });
    assert({
      given: 'a completed quick-length ranked round drawn',
      should: 'rate it on the quick ladder as a draw',
      actual: ratingEligibility({
        ...completed,
        ladderId: 'quick',
        outcome: 'draw',
      }),
      expected: {
        kind: 'rated',
        ladder: 'quick',
        outcome: 'draw',
        occurredAt: at,
      },
    });
  });

  test('never rates unrated competition or an abandoned round', () => {
    assert({
      given: 'casual and practice rounds, which carry no ladder',
      should: 'leave them unrated for their competition type',
      actual: [
        ratingEligibility({
          ...completed,
          competitionType: 'casual',
          ladderId: null,
        }),
        ratingEligibility({
          ...completed,
          competitionType: 'practice',
          ladderId: null,
        }),
      ],
      expected: [
        { kind: 'unrated', reason: 'competition' },
        { kind: 'unrated', reason: 'competition' },
      ],
    });
    assert({
      given: 'an abandoned ranked round',
      should: 'leave it unrated',
      actual: ratingEligibility({
        ...completed,
        status: 'abandoned',
        outcome: null,
        completedAt: null,
      }),
      expected: { kind: 'unrated', reason: 'abandoned' },
    });
  });

  test('reports a round that is already rated', () => {
    assert({
      given: 'a rated round that already has ledger rows',
      should: 'report it as already rated',
      actual: ratingEligibility({ ...completed, alreadyRated: true }),
      expected: { kind: 'already-rated' },
    });
    assert({
      given: 'a rerun whose stored columns moved',
      should: 'still report it as already rated',
      actual: ratingEligibility({
        ...completed,
        alreadyRated: true,
        ladderId: null,
      }),
      expected: { kind: 'already-rated' },
    });
  });

  test('refuses a round that has not completed', async () => {
    await assertRejects({
      given: 'an active ranked round',
      should: 'refuse as a conflict',
      actual: () =>
        ratingEligibility({
          ...completed,
          status: 'active',
          outcome: null,
          completedAt: null,
        }),
      code: 'CONFLICT',
    });
  });
});

const newcomer: DebaterStanding = {
  current: null,
  previous: null,
  lastRatedAt: null,
};
const seats = [
  { actorId: 'aff', role: 'affirmative' },
  { actorId: 'neg', role: 'negative' },
] as const;
const plan = (
  standings: Readonly<Record<string, DebaterStanding>>,
  overrides: Partial<Parameters<typeof planRating>[0]> = {},
) =>
  planRating({
    ladder: 'ranked',
    outcome: 'affirmative',
    occurredAt: at,
    seasonId: 'season-1',
    seats,
    standings,
    changeIds: ['change-aff', 'change-neg'],
    ...overrides,
  });

describe('planRating', () => {
  test('plans both sides from the pure calculation', () => {
    const expected = rateDebate({
      affirmative: { state: ratingPolicy.initial, lastRatedAt: null },
      negative: { state: ratingPolicy.initial, lastRatedAt: null },
      outcome: 'affirmative',
      occurredAt: at,
    });
    assert({
      given: 'two newcomers and an affirmative win',
      should:
        'plan one change per side equal to rateDebate, inserting new rows',
      actual: plan({ aff: newcomer, neg: newcomer }),
      expected: {
        ladder: 'ranked',
        seasonId: 'season-1',
        occurredAt: at,
        calculationVersion: 'glicko2-v1',
        changes: [
          {
            changeId: 'change-aff',
            actorId: 'aff',
            ...expected.affirmative,
            expectedVersion: null,
          },
          {
            changeId: 'change-neg',
            actorId: 'neg',
            ...expected.negative,
            expectedVersion: null,
          },
        ],
      },
    });
  });

  test('starts from the current row, else a carried row, else the initial state', () => {
    const current = { rating: 1620, deviation: 80, volatility: 0.06 };
    const previous = { rating: 1720, deviation: 60, volatility: 0.05 };
    const result = plan({
      aff: {
        current: { state: current, version: 4 },
        previous,
        lastRatedAt: at,
      },
      neg: { current: null, previous, lastRatedAt: at },
    });
    assert({
      given: 'a debater with a row this season',
      should: 'start from it and expect its version',
      actual: [result.changes[0]?.before, result.changes[0]?.expectedVersion],
      expected: [current, 4],
    });
    assert({
      given: 'a debater with only an earlier season',
      should: 'carry it with the season deviation floor',
      actual: [result.changes[1]?.before, result.changes[1]?.expectedVersion],
      expected: [{ rating: 1720, deviation: 150, volatility: 0.05 }, null],
    });
  });

  test('posts a late debate just after the debaters latest posting', () => {
    const later = '2026-10-05T13:00:00.000Z';
    const late = plan({
      aff: { ...newcomer, lastRatedAt: later },
      neg: newcomer,
    });
    assert({
      given: 'a debater already posted for a debate that completed later',
      should:
        'rate it anyway, posted one millisecond after that posting so the ledger stays ordered',
      actual: [late.occurredAt, late.changes.length],
      expected: ['2026-10-05T13:00:00.001Z', 2],
    });
    assert({
      given: 'a debater whose latest posting is exactly this completion',
      should: 'post one millisecond after it',
      actual: plan({ aff: { ...newcomer, lastRatedAt: at }, neg: newcomer })
        .occurredAt,
      expected: '2026-10-05T12:00:00.001Z',
    });
    assert({
      given: 'debaters last posted before this completion',
      should: 'post at the completion',
      actual: plan({
        aff: { ...newcomer, lastRatedAt: '2026-10-04T12:00:00.000Z' },
        neg: newcomer,
      }).occurredAt,
      expected: at,
    });
  });

  test('refuses without an active season or a debater per side', async () => {
    await assertRejects({
      given: 'no active season',
      should: 'refuse as a conflict',
      actual: () => plan({ aff: newcomer, neg: newcomer }, { seasonId: null }),
      code: 'CONFLICT',
    });
    await assertRejects({
      given: 'only an affirmative seat',
      should: 'refuse as a conflict',
      actual: () =>
        plan(
          { aff: newcomer },
          { seats: [{ actorId: 'aff', role: 'affirmative' }] },
        ),
      code: 'CONFLICT',
    });
    await assertRejects({
      given: 'a seat whose standing was not loaded',
      should: 'refuse as an internal error',
      actual: () => plan({ aff: newcomer }),
      code: 'INTERNAL',
    });
  });
});
