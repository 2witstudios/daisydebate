import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { frozen, round } from '../round-judging/judging.test-support';
import { createRoundCoachingOperations } from './operations';

setupRitewayBun();

const coaching = {
  affirmative: 'Weigh access against their cost argument.',
  negative: 'Answer the access turn before you extend.',
};
const claim = { token: 't', attempt: 1, model: 'judge-model', round, frozen };

const harness = (answer: string, claimed: typeof claim | null = claim) => {
  const calls: unknown[] = [];
  const operations = createRoundCoachingOperations({
    store: {
      claimRoundFeedbackJob: async (roundId) => {
        calls.push(['claim', roundId]);
        return claimed as never;
      },
      recordRoundFeedbackUsage: async (...args) => {
        calls.push(['usage', ...args]);
      },
      completeRoundFeedbackJob: async (...args) => {
        calls.push(['complete', ...args]);
      },
    },
    voice: () => ({
      complete: async (request) => {
        calls.push(['provider', request.model, request.messages.length]);
        return { text: answer, promptTokens: 120, completionTokens: 40 };
      },
    }),
    withProvider: (_signal, work) => work(),
  });
  return { calls, operations };
};

test('a claimed Round is coached once, its usage recorded before its result', async () => {
  const { calls, operations } = harness(JSON.stringify(coaching));
  await operations.coach('round', new AbortController().signal);
  assert({
    given: 'a claimable Round and a valid coaching answer',
    should:
      'claim it, call the configured model once, record its usage, then store both sides’ coaching under the claim’s lease',
    actual: calls,
    expected: [
      ['claim', 'round'],
      ['provider', 'judge-model', 2],
      ['usage', 'round', 't', { inputTokens: 120, outputTokens: 40 }],
      ['complete', 'round', 't', coaching],
    ],
  });
});

test('an invalid answer is paid for but never stored', async () => {
  const { calls, operations } = harness('Great round, both of you!');
  await assertRejects({
    given: 'a coaching answer that is not the JSON contract',
    should: 'refuse with INFRASTRUCTURE',
    actual: () => operations.coach('round', new AbortController().signal),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'the refused answer',
    should: 'still record its usage and store no coaching',
    actual: calls.map((call) => (call as unknown[])[0]),
    expected: ['claim', 'provider', 'usage'],
  });
});

test('a Round another process holds is left alone', async () => {
  const { calls, operations } = harness(JSON.stringify(coaching), null);
  await operations.coach('round', new AbortController().signal);
  assert({
    given: 'a Round whose claim is refused',
    should: 'make no provider call',
    actual: calls,
    expected: [['claim', 'round']],
  });
});

test('a cancelled claim buys nothing', async () => {
  const { calls, operations } = harness(JSON.stringify(coaching));
  const abort = new AbortController();
  abort.abort();
  await assertRejects({
    given: 'a claim whose worker is stopping',
    should: 'refuse with CONFLICT',
    actual: () => operations.coach('round', abort.signal),
    code: 'CONFLICT',
  });
  assert({
    given: 'the cancelled claim',
    should: 'claim nothing and make no provider call',
    actual: calls,
    expected: [],
  });
});
