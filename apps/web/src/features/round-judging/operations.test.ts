import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundJudgingOperations } from './operations';
import {
  frozen,
  round,
} from '../round-runtime/transcript-evidence.test-support';
setupRitewayBun();

test('a judging job that may buy no more calls never reaches the provider', async () => {
  let provider = 0;
  let submitted = 0;
  const operations = createRoundJudgingOperations({
    store: {
      verifyRoundJudgingJob: async () => ({
        expectedVersion: 1,
        pendingBallot: null,
      }),
      beginRoundJudgingModelCall: async () => false,
      recordRoundJudgingUsage: async () => undefined,
      saveRoundJudgingResult: async () => undefined,
      submitRoundJudgingResult: async () => {
        submitted++;
      },
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
  await operations.executeClaim(
    { scope: {}, token: 't', model: 'm', round, frozen } as never,
    new AbortController().signal,
  );
  assert({
    given: 'a judging job whose store refuses another paid call (ISSUE-461)',
    should: 'make no provider call and submit nothing',
    actual: { provider, submitted },
    expected: { provider: 0, submitted: 0 },
  });
});

const claim = { scope: {}, token: 't', model: 'm', round, frozen } as never;
function harness(complete: () => Promise<unknown>) {
  const log = {
    provider: 0,
    saved: 0,
    submitted: 0,
    failures: [] as { category: string; definite: boolean; final: boolean }[],
    ended: [] as string[],
    usage: 0,
  };
  let next: 'retry' | 'attempts_exhausted' = 'retry';
  const operations = createRoundJudgingOperations({
    store: {
      verifyRoundJudgingJob: async () => ({
        expectedVersion: 1,
        pendingBallot: null,
      }),
      beginRoundJudgingModelCall: async () => true,
      recordRoundJudgingUsage: async () => {
        log.usage++;
      },
      recordRoundJudgingAttemptFailure: async (
        _scope: unknown,
        _token: unknown,
        input: {
          diagnostic: { category: string };
          definite: boolean;
          final: boolean;
        },
      ) => {
        log.failures.push({
          category: input.diagnostic.category,
          definite: input.definite,
          final: input.final,
        });
        return next;
      },
      saveRoundJudgingResult: async () => {
        log.saved++;
        return true;
      },
      submitRoundJudgingResult: async () => {
        log.submitted++;
      },
    } as never,
    nextId: () => 'x'.repeat(24),
    voice: () =>
      ({
        complete: async () => {
          log.provider++;
          return complete();
        },
      }) as never,
    withProvider: (_signal, work) => work(),
    jobEnded: (category) => log.ended.push(category),
  });
  return { log, operations, exhaust: () => (next = 'attempts_exhausted') };
}
const reply = (text: string, finish = 'stop') => ({
  text,
  finish,
  refused: false,
  promptTokens: 5,
  completionTokens: 5,
});

test('a rejected answer is durable at once, with usage kept and nothing submitted', async () => {
  const { log, operations, exhaust } = harness(async () => reply('{"a":1}'));
  await operations.executeClaim(claim, new AbortController().signal);
  assert({
    given: 'a schema-rejected answer with attempts left',
    should: 'record the attempt and usage, submit nothing, not report an end',
    actual: { ...log },
    expected: {
      provider: 1,
      saved: 0,
      submitted: 0,
      failures: [
        { category: 'schema_rejected', definite: false, final: false },
      ],
      ended: [],
      usage: 1,
    },
  });
  exhaust();
  await operations.executeClaim(claim, new AbortController().signal);
  assert({
    given: 'the final permitted answer also rejected',
    should: 'report the end once, on that call',
    actual: log.ended,
    expected: ['schema_rejected'],
  });
});

test('provider failures are classified apart', async () => {
  const refused = harness(async () => {
    const { createOpenRouter } = await import('@daisy/ai-voice');
    return createOpenRouter({
      apiKey: 'k',
      fetch: async () => new Response('', { status: 404 }),
    }).complete({ model: 'm', messages: [], maxTokens: 1 });
  });
  await refused.operations.executeClaim(claim, new AbortController().signal);
  assert({
    given: 'the vendor refusing the request',
    should: 'record a definite refusal that buys nothing',
    actual: refused.log.failures,
    expected: [{ category: 'provider_refused', definite: true, final: true }],
  });
  const uncertain = harness(async () => {
    throw new Error('socket lost');
  });
  await uncertain.operations.executeClaim(claim, new AbortController().signal);
  assert({
    given: 'an uncertain provider failure',
    should: 'stay counted as possibly served',
    actual: uncertain.log.failures,
    expected: [{ category: 'provider_error', definite: false, final: false }],
  });
  const timer = new AbortController();
  timer.abort(new DOMException('late', 'TimeoutError'));
  const timedOut = harness(async () => {
    throw new Error('aborted');
  });
  await timedOut.operations.executeClaim(claim, timer.signal).catch(() => null);
  assert({
    given: 'an already-timed-out call',
    should: 'make no provider call',
    actual: timedOut.log.provider,
    expected: 0,
  });
});

test('a released worker never records a failure for a lease it lost', async () => {
  const release = new AbortController();
  const { log, operations } = harness(async () => {
    release.abort(new Error('released'));
    throw new Error('aborted');
  });
  const outcome = await operations.executeClaim(claim, release.signal).then(
    () => 'finished',
    () => 'refused',
  );
  assert({
    given: 'the worker released while the call ran',
    should: 'propagate without a durable attempt',
    actual: { outcome, failures: log.failures },
    expected: { outcome: 'refused', failures: [] },
  });
});

test('a rate limit may retry, and a timeout during the call stays counted as paid', async () => {
  const limited = harness(async () => {
    const { createOpenRouter } = await import('@daisy/ai-voice');
    return createOpenRouter({
      apiKey: 'k',
      fetch: async () => new Response('', { status: 429 }),
    }).complete({ model: 'm', messages: [], maxTokens: 1 });
  });
  await limited.operations.executeClaim(claim, new AbortController().signal);
  assert({
    given: 'a 429',
    should: 'buy nothing but stay retryable',
    actual: limited.log.failures,
    expected: [{ category: 'provider_refused', definite: true, final: false }],
  });
  const clock = new AbortController();
  const late = harness(async () => {
    clock.abort(new DOMException('late', 'TimeoutError'));
    throw new Error('aborted');
  });
  await late.operations.executeClaim(claim, clock.signal);
  assert({
    given: 'the per-call timeout firing while the call runs',
    should: 'record a timeout that may have been served',
    actual: late.log.failures,
    expected: [{ category: 'timeout', definite: false, final: false }],
  });
});
