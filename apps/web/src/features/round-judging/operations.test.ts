import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundJudgingOperations } from './operations';
import { frozen, round } from './judging.test-support';
setupRitewayBun();

test('a judging job that may buy no more calls never reaches the provider', async () => {
  let provider = 0;
  const operations = createRoundJudgingOperations({
    store: {
      verifyRoundJudgingJob: async () => ({
        expectedVersion: 1,
        pendingBallot: null,
      }),
      beginRoundJudgingModelCall: async () => false,
      recordRoundJudgingUsage: async () => undefined,
      saveRoundJudgingResult: async () => undefined,
      submitRoundJudgingResult: async () => undefined,
    } as never,
    nextId: () => 'x'.repeat(24),
    voice: () =>
      ({
        complete: async () => {
          provider++;
          return { text: '{}', promptTokens: 1, completionTokens: 1 };
        },
      }) as never,
    withProvider: (_signal, work) => work(),
  });
  const outcome = await operations
    .executeClaim(
      { scope: {}, token: 't', model: 'm', round, frozen } as never,
      new AbortController().signal,
    )
    .then(
      () => 'submitted',
      (error: Error) => error.message,
    );
  assert({
    given: 'a judging job whose store refuses another paid call (ISSUE-461)',
    should: 'make no provider call and end with a coded exhaustion',
    actual: { provider, outcome },
    expected: { provider: 0, outcome: 'Judging attempts exhausted' },
  });
});
