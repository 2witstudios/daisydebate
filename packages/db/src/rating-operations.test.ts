import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createTestDatabase,
  debateRow,
  sampleSnapshot,
} from './index.test-support';
import type { RatingPlanFacts } from '@daisy/protocol';
import type { RatingDecision } from './rating-facts';

setupRitewayBun();

const debateId = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const at = '2026-10-05T12:30:00.000Z';
const snapshot = sampleSnapshot({ phase: 'completed' });

// Schema-definition column order; the driver returns rows positionally.
const completedRow = (mode: 'ranked' | 'casual') =>
  debateRow({
    id: debateId,
    createdBy: null,
    resolution: snapshot.resolution,
    format: 'public-forum',
    snapshot,
    createdAt: '2026-10-05T12:00:00.000Z',
    updatedAt: at,
    version: 2,
    mode,
    phase: 'completed',
    visibility: 'public',
    startedAt: '2026-10-05T12:00:00.000Z',
    completedAt: at,
    outcome: 'affirmative',
  });

const state = { rating: 1500, deviation: 350, volatility: 0.06 };

/** Records the facts it is given and decides a fixed rated result. */
const recording = (seen: unknown[]): RatingDecision => ({
  eligibility: (facts) => {
    seen.push(facts);
    return facts.mode === 'ranked'
      ? {
          kind: 'rated',
          ladder: 'ranked',
          outcome: 'affirmative',
          occurredAt: at,
        }
      : { kind: 'unrated', reason: 'mode' };
  },
  plan: (facts: RatingPlanFacts) => {
    seen.push(facts);
    return {
      ladder: facts.ladder,
      seasonId: facts.seasonId ?? '',
      occurredAt: facts.occurredAt,
      calculationVersion: 'stub-v1',
      changes: facts.seats.map(({ actorId }, index) => ({
        changeId: facts.changeIds[index] ?? '',
        actorId,
        before: state,
        after: { ...state, rating: 1500 + (index === 0 ? 10 : -10) },
        expectedVersion: null,
      })),
    };
  },
});

/** The reads and writes of one rated attempt, ending in two projection writes. */
type Script = Parameters<typeof createTestDatabase>[0];

const ratedAttempt = (projectionWrites: Script): Script => [
  [completedRow('ranked')],
  [[snapshot.rules, true]],
  [],
  [
    ['aff', 'affirmative'],
    ['neg', 'negative'],
  ],
  [['season-1']],
  [],
  [],
  [[null]],
  [],
  [],
  [[null]],
  [],
  ...projectionWrites,
];

describe('rateDebate', () => {
  test('refuses an unknown debate', async () => {
    const { database } = createTestDatabase([[]]);
    await assertRejects({
      given: 'no debate row',
      should: 'refuse as not found',
      actual: () =>
        database.rateDebate({
          debateId,
          changeIds: ['c1', 'c2'],
          decide: recording([]),
        }),
      code: 'NOT_FOUND',
    });
  });

  test('refuses stored format rules that do not parse', async () => {
    const { database } = createTestDatabase([
      [completedRow('ranked')],
      [[{ version: 1, seats: snapshot.rules.seats, clock: {} }, true]],
      [],
    ]);
    await assertRejects({
      given: 'format rules missing their clock durations',
      should: 'refuse as an internal error before deciding anything',
      actual: () =>
        database.rateDebate({
          debateId,
          changeIds: ['c1', 'c2'],
          decide: recording([]),
        }),
      code: 'INTERNAL',
    });
  });

  test('returns an unrated decision without reading further', async () => {
    const seen: unknown[] = [];
    const { database, queries } = createTestDatabase([
      [completedRow('casual')],
      [[snapshot.rules, true]],
      [],
    ]);
    const result = await database.rateDebate({
      debateId,
      changeIds: ['c1', 'c2'],
      decide: recording(seen),
    });
    assert({
      given: 'a casual debate',
      should: 'return the decision after the debate, format and ledger reads',
      actual: [result, queries.length],
      expected: [{ kind: 'unrated', reason: 'mode' }, 3],
    });
    assert({
      given: 'the loaded debate',
      should: 'decide from its mode, phase, outcome, completion and rules',
      actual: seen[0],
      expected: {
        mode: 'casual',
        phase: 'completed',
        outcome: 'affirmative',
        completedAt: at,
        rules: snapshot.rules,
        format: { rules: snapshot.rules, rankedEligible: true },
        alreadyRated: false,
      },
    });
  });

  test('writes the planned changes and reports them', async () => {
    const seen: unknown[] = [];
    const { database } = createTestDatabase(ratedAttempt([[[1]], [[1]]]));
    const result = await database.rateDebate({
      debateId,
      changeIds: ['c1', 'c2'],
      decide: recording(seen),
    });
    assert({
      given: 'a ranked debate between two newcomers',
      should: 'report both planned changes in the active season',
      actual: result,
      expected: {
        kind: 'rated',
        ladder: 'ranked',
        seasonId: 'season-1',
        changes: [
          {
            id: 'c1',
            actorId: 'aff',
            before: state,
            after: { ...state, rating: 1510 },
          },
          {
            id: 'c2',
            actorId: 'neg',
            before: state,
            after: { ...state, rating: 1490 },
          },
        ],
      },
    });
    assert({
      given: 'two seats with no ratings',
      should: 'plan from empty standings in the active season',
      actual: seen[1],
      expected: {
        ladder: 'ranked',
        outcome: 'affirmative',
        occurredAt: at,
        seasonId: 'season-1',
        seats: [
          { actorId: 'aff', role: 'affirmative' },
          { actorId: 'neg', role: 'negative' },
        ],
        standings: {
          aff: { current: null, previous: null, lastRatedAt: null },
          neg: { current: null, previous: null, lastRatedAt: null },
        },
        changeIds: ['c1', 'c2'],
      },
    });
  });

  test('gives up as a conflict when projections keep moving', async () => {
    const stale = ratedAttempt([[]]);
    const { database } = createTestDatabase([...stale, ...stale, ...stale]);
    await assertRejects({
      given: 'a projection insert that loses its race on every attempt',
      should: 'refuse as a conflict after three attempts',
      actual: () =>
        database.rateDebate({
          debateId,
          changeIds: ['c1', 'c2'],
          decide: recording([]),
        }),
      code: 'CONFLICT',
    });
  });
});
