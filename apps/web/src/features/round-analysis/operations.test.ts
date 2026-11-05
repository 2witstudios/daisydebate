import { assertRejects } from '@daisy/errors/testing';
import { createOpenRouter } from '@daisy/ai-voice';
import { sampleRoundAnalysisReport as report } from '@daisy/protocol/round-analysis-testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  frozen,
  round,
} from '../round-runtime/transcript-evidence.test-support';
import { createRoundAnalysisOperations } from './operations';
setupRitewayBun();
const seat = { roundId: 'round', roundParticipantId: 'seat' };
const claim = {
  token: 't',
  callId: 'call',
  model: 'analysis-model',
  seat: { ...seat, side: 'affirmative' as const, slot: 1 },
  round,
  frozen,
  history: [],
};
function harness(
  input: {
    text?: string;
    beforeClaim?: () => Promise<void>;
    allowed?: () => boolean;
    claimed?: boolean;
    provider?: Parameters<typeof createRoundAnalysisOperations>[0]['voice'];
  } = {},
) {
  const calls: unknown[] = [];
  const operations = createRoundAnalysisOperations({
    store: {
      claimRoundAnalysisJob: async () => {
        calls.push('claim');
        await input.beforeClaim?.();
        return input.claimed === false ? null : claim;
      },
      beginRoundAnalysisModelCall: async () => {
        calls.push('dispatch');
        return input.allowed?.() === false ? null : true;
      },
      recordRoundAnalysisOutcome: async (_seat, _id, _token, outcome) => {
        calls.push(['outcome', outcome]);
        return { kind: 'unchanged' as const };
      },
      completeRoundAnalysisJob: async (_seat, _id, _token, result) => {
        calls.push(['report', result]);
      },
      retryRoundAnalysisJob: async () => {
        calls.push('retry');
        return { kind: 'unchanged' as const };
      },
    },
    voice:
      input.provider ??
      (() => ({
        complete: async () => {
          calls.push('provider');
          return {
            text: input.text ?? JSON.stringify(report),
            finish: 'stop' as const,
            refused: false,
            promptTokens: 120,
            completionTokens: 40,
          };
        },
      })),
    withProvider: (_signal, work) => work(),
  });
  return { calls, operations };
}
test('requested analysis counts at dispatch and records received service before parsing a report', async () => {
  const f = harness();
  await f.operations.analyse(seat, new AbortController().signal);
  assert({
    given: 'a current requested lease and valid report',
    should:
      'cross the dispatch fence once and record provider outcome before publishing',
    actual: f.calls,
    expected: [
      'claim',
      'dispatch',
      'provider',
      ['outcome', { kind: 'received', inputTokens: 120, outputTokens: 40 }],
      ['report', report],
    ],
  });
  const invalid = harness({ text: 'Invalid report' });
  await assertRejects({
    given: 'received text outside the report contract',
    should: 'retain paid service and schedule bounded retry',
    actual: () =>
      invalid.operations.analyse(seat, new AbortController().signal),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'invalid received content',
    should: 'record service without publishing a report',
    actual: invalid.calls,
    expected: [
      'claim',
      'dispatch',
      'provider',
      ['outcome', { kind: 'received', inputTokens: 120, outputTokens: 40 }],
      'retry',
    ],
  });
});
test('authority lost while a claim is paused prevents provider I/O', async () => {
  let allowed = true;
  const claimed = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const f = harness({
    beforeClaim: () => {
      claimed.resolve();
      return resume.promise;
    },
    allowed: () => allowed,
  });
  const work = f.operations.analyse(seat, new AbortController().signal);
  await claimed.promise;
  allowed = false;
  resume.resolve();
  await work;
  assert({
    given: 'claim data returned after an intervening erasure/lease replacement',
    should: 'ask fresh dispatch authority and invoke no provider',
    actual: f.calls,
    expected: ['claim', 'dispatch'],
  });
});
test('cancellation before dispatch has no counted call, and a missing claim does no work', async () => {
  const abort = new AbortController();
  const f = harness({
    beforeClaim: async () => {
      abort.abort();
    },
  });
  await assertRejects({
    given: 'a worker cancelled after claim',
    should: 'release through bounded retry without dispatch',
    code: 'CONFLICT',
    actual: () => f.operations.analyse(seat, abort.signal),
  });
  const missing = harness({ claimed: false });
  await missing.operations.analyse(seat, new AbortController().signal);
  assert({
    given: 'cancelled and unclaimed work',
    should: 'make no provider invocation',
    actual: [f.calls, missing.calls],
    expected: [['claim', 'retry'], ['claim']],
  });
});
test('only affirmative provider nonservice is observed as definite failure', async () => {
  for (const status of [429, 500]) {
    const f = harness({
      provider: () =>
        createOpenRouter({
          apiKey: 'fixture',
          fetch: async () => new Response('', { status }),
        }),
    });
    await assertRejects({
      given: `provider HTTP ${status}`,
      should: 'record only proven nonservice and retain unknown otherwise',
      code: 'INFRASTRUCTURE',
      actual: () => f.operations.analyse(seat, new AbortController().signal),
    });
    assert({
      given: `the ${status} provider outcome`,
      should:
        'retry within the same identity and never invent a received result',
      actual: f.calls,
      expected:
        status === 429
          ? [
              'claim',
              'dispatch',
              ['outcome', { kind: 'definite_failure' }],
              'retry',
            ]
          : ['claim', 'dispatch', 'retry'],
    });
  }
});
