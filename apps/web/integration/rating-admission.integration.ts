import { createId } from '@paralleldrive/cuid2';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rateCompletedRound } from '../src/features/ratings/rate-debate';
import { inArena } from './ratings-arena';

setupRitewayBun();

test('actual rating application decisions refuse atomically, then replay skips new admission', async () => {
  await inArena(async ({ database, actor, round, ledger, ratings }) => {
    const first = await actor(),
      second = await actor();
    const id = await round({ affirmative: first, negative: second });
    let mode:
      'unrated' | 'competition-refusal' | 'standing-refusal' | 'accept' =
      'unrated';
    const comparisons: (readonly string[])[] = [];
    const standings: boolean[] = [];
    const rate = () =>
      rateCompletedRound(
        {
          rateRound: (input) =>
            database.rateRound({
              ...input,
              decide: {
                ...input.decide,
                competition: (sides) => {
                  comparisons.push(sides);
                  const choice = input.decide.competition(sides);
                  if (mode === 'unrated')
                    return { kind: 'unrated', reason: 'competition' };
                  if (mode === 'competition-refusal')
                    throw createAppError('CONFLICT');
                  return choice;
                },
                requireStandingRules: (facts) => {
                  standings.push(facts.previousWithoutRules);
                  input.decide.requireStandingRules(facts);
                  if (mode === 'standing-refusal')
                    throw createAppError('CONFLICT');
                },
              },
            }),
        },
        id,
        { next: createId },
      );
    assert({
      given: 'application competition admission refuses rating',
      should:
        'return its existing competition result without consulting standings',
      actual: [await rate(), standings],
      expected: [{ kind: 'unrated', reason: 'competition' }, []],
    });
    for (const refusal of [
      'competition-refusal',
      'standing-refusal',
    ] as const) {
      mode = refusal;
      await assertRejects({
        given: `an actual application ${refusal}`,
        should: 'refuse the locked posting',
        actual: rate,
        code: 'CONFLICT',
      });
      assert({
        given: 'a refusal before rating materialization',
        should: 'leave both ledgers and projections untouched',
        actual: [
          await ledger(first),
          await ledger(second),
          await ratings(first),
          await ratings(second),
        ],
        expected: [[], [], [], []],
      });
    }
    assert({
      given: 'fresh frozen sides and no prior standings',
      should: 'supply the actual named comparison and no unresolved carryover',
      actual: [comparisons, standings],
      expected: [
        [
          ['affirmative', 'negative'],
          ['affirmative', 'negative'],
          ['affirmative', 'negative'],
        ],
        [false],
      ],
    });
    mode = 'accept';
    const result = await rate();
    const beforeReplay = [comparisons.length, standings.length];
    assert({
      given:
        'normal application admission after refusal, then exact posting replay',
      should: 'post each actor once and recover before any new admission',
      actual: [
        result.kind,
        await rate(),
        (await ledger(first)).length,
        (await ledger(second)).length,
        [comparisons.length, standings.length],
      ],
      expected: ['rated', { kind: 'already-rated' }, 1, 1, beforeReplay],
    });
  });
});
