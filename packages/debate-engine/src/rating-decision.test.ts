import { assertRejects } from '@daisy/errors/testing';
import type {
  DebaterStanding,
  FormatRules,
  RatingEligibilityFacts,
} from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { rateDebate, ratingPolicy } from './rating';
import { planRating, ratingEligibility } from './rating-decision';

setupRitewayBun();

const rules: FormatRules = {
  version: 1,
  seats: { affirmative: 1, negative: 1, judge: 1 },
  clock: { speechMs: 240_000, prepMs: 60_000 },
};
const at = '2026-10-05T12:00:00.000Z';

const completed: RatingEligibilityFacts = {
  mode: 'ranked',
  phase: 'completed',
  outcome: 'affirmative',
  completedAt: at,
  rules,
  format: { rules, rankedEligible: true },
  alreadyRated: false,
};

describe('ratingEligibility', () => {
  test('rates a completed ranked or quick debate on canonical rules', () => {
    assert({
      given: 'a completed ranked debate on canonical rules',
      should: 'rate it on the ranked ladder with its outcome and completion',
      actual: ratingEligibility(completed),
      expected: {
        kind: 'rated',
        ladder: 'ranked',
        outcome: 'affirmative',
        occurredAt: at,
      },
    });
    assert({
      given: 'a completed quick match drawn',
      should: 'rate it on the quick ladder as a draw',
      actual: ratingEligibility({
        ...completed,
        mode: 'quick',
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

  test('never rates unrated modes, abandoned debates or overridden rules', () => {
    assert({
      given: 'casual and practice debates',
      should: 'leave them unrated for their mode',
      actual: [
        ratingEligibility({ ...completed, mode: 'casual' }),
        ratingEligibility({ ...completed, mode: 'practice' }),
      ],
      expected: [
        { kind: 'unrated', reason: 'mode' },
        { kind: 'unrated', reason: 'mode' },
      ],
    });
    assert({
      given: 'an abandoned ranked debate',
      should: 'leave it unrated',
      actual: ratingEligibility({ ...completed, outcome: 'abandoned' }),
      expected: { kind: 'unrated', reason: 'abandoned' },
    });
    assert({
      given: 'overridden rules or a format that is not ranked-eligible',
      should: 'leave the debate unrated for its rules',
      actual: [
        ratingEligibility({
          ...completed,
          rules: { ...rules, clock: { speechMs: 1_000, prepMs: 0 } },
        }),
        ratingEligibility({
          ...completed,
          format: { rules, rankedEligible: false },
        }),
      ],
      expected: [
        { kind: 'unrated', reason: 'rules' },
        { kind: 'unrated', reason: 'rules' },
      ],
    });
  });

  test('reports a debate that is already rated', () => {
    assert({
      given: 'a rated debate that already has ledger rows',
      should: 'report it as already rated',
      actual: ratingEligibility({ ...completed, alreadyRated: true }),
      expected: { kind: 'already-rated' },
    });
  });

  test('refuses a debate that has not completed', async () => {
    await assertRejects({
      given: 'an active ranked debate',
      should: 'refuse as a conflict',
      actual: () =>
        ratingEligibility({
          ...completed,
          phase: 'active',
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
      given: 'a debater already rated for a debate that completed later',
      should: 'refuse as a conflict rather than rewrite the ledger order',
      actual: () =>
        plan({
          aff: { ...newcomer, lastRatedAt: '2026-10-05T13:00:00.000Z' },
          neg: newcomer,
        }),
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
