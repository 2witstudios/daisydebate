import { assertRejects } from '@daisy/errors/testing';
import { fixedIds } from '@daisy/clock';
import type { RateDebateInput } from '@daisy/db/ratings';
import { planRating, ratingEligibility } from '@daisy/debate-engine';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { rateCompletedRound } from './rate-debate';

setupRitewayBun();

describe('rateCompletedRound', () => {
  test('rates through the adapter with the engine decision and fresh ids', async () => {
    const calls: RateDebateInput[] = [];
    const database = {
      rateRound: async (input: RateDebateInput) => {
        calls.push(input);
        return { kind: 'already-rated' } as const;
      },
    };
    const result = await rateCompletedRound(
      database,
      'debate-1',
      fixedIds(['change-aff', 'change-neg']),
    );
    assert({
      given: 'a completed debate id and an id source',
      should:
        'pass the debate, two change ids and the engine decision to the adapter and return its result',
      actual: {
        result,
        roundId: calls[0]?.roundId,
        changeIds: [calls[0]?.nextChangeId(), calls[0]?.nextChangeId()],
        eligibility: calls[0]?.decide.eligibility === ratingEligibility,
        plan: calls[0]?.decide.plan === planRating,
      },
      expected: {
        result: { kind: 'already-rated' },
        roundId: 'debate-1',
        changeIds: ['change-aff', 'change-neg'],
        eligibility: true,
        plan: true,
      },
    });
  });
});

test('the application supplies competition admission and unresolved-carryover refusal', async () => {
  let captured: RateDebateInput | undefined;
  await rateCompletedRound(
    {
      rateRound: async (input) => {
        captured = input;
        return { kind: 'already-rated' };
      },
    },
    'round',
    fixedIds([]),
  );
  const decide = captured!.decide;
  assert({
    given: 'two named sides or a multi-sided competition',
    should:
      'preserve the two-side pool and refuse other competition without a plan',
    actual: [
      decide.competition([]),
      decide.competition(['one']),
      decide.competition(['one', 'two']),
      decide.competition(['one', 'two', 'three']),
    ],
    expected: [
      { kind: 'unrated', reason: 'competition' },
      { kind: 'unrated', reason: 'competition' },
      { kind: 'rated', sides: ['one', 'two'] },
      { kind: 'unrated', reason: 'competition' },
    ],
  });
  await assertRejects({
    given: 'a prior-season standing without approved standing rules',
    should: 'retain the DEC111 fail-closed refusal',
    actual: () => decide.requireStandingRules({ previousWithoutRules: true }),
    code: 'CONFLICT',
  });
  assert({
    given: 'no unresolved prior-season standing',
    should: 'leave normal planning available',
    actual: decide.requireStandingRules({ previousWithoutRules: false }),
    expected: undefined,
  });
});
