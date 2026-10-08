import { fixedIds } from '@daisy/clock';
import type { RateDebateInput } from '@daisy/db';
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
        changeIds: calls[0]?.changeIds,
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
