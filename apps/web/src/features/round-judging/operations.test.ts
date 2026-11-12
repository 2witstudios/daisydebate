import { assert, setupRitewayBun, test } from 'riteway/bun';
import { stubCaseMap } from '@daisy/ai-voice/testing';
import { createRoundJudgingOperations } from './operations';
import { claim, harness, reply } from './operations.test-support';
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
        stage: 'final',
        caseMap: stubCaseMap,
      }),
      beginRoundJudgingModelCall: async () => ({
        kind: 'deferred' as const,
        reason: 'attempt_window' as const,
      }),
      recordRoundJudgingUsage: async () => undefined,
      saveRoundJudgingResult: async () => ({ kind: 'held' as const }),
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

test('the judging request asks only for what its route can serve (ISSUE-884)', async () => {
  let sent: Record<string, unknown> = {};
  const { operations } = harness(async (request) => {
    sent = request as Record<string, unknown>;
    return reply('{"a":1}');
  });
  await operations.executeClaim(claim, new AbortController().signal);
  assert({
    given:
      'a schema-constrained request, where routing requires every parameter and no zero-retention endpoint of the judging model accepts temperature',
    should: 'send no temperature, so a route can serve it',
    actual: {
      constrained: sent.outputSchema !== undefined,
      temperature: 'temperature' in sent,
    },
    expected: { constrained: true, temperature: false },
  });
});

test('a rejected answer is durable at once, with usage kept and nothing submitted', async () => {
  const { log, operations } = harness(async () => reply('{"a":1}'));
  await operations.executeClaim(claim, new AbortController().signal);
  assert({
    given: 'a schema-rejected answer with attempts left',
    should: 'record the attempt and usage, submit nothing, not report an end',
    actual: { ...log },
    expected: {
      provider: 1,
      saved: 0,
      submitted: 0,
      failures: [{ category: 'schema_rejected', final: false }],
      usage: 1,
    },
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
    expected: [{ category: 'provider_refused', final: true }],
  });
  const uncertain = harness(async () => {
    throw new Error('socket lost');
  });
  await uncertain.operations.executeClaim(claim, new AbortController().signal);
  assert({
    given: 'an uncertain provider failure',
    should: 'stay counted as possibly served',
    actual: uncertain.log.failures,
    expected: [{ category: 'provider_error', final: false }],
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

test('only a refusal of the request itself is final: a key or credit failure can still be fixed', async () => {
  const refusedWith = async (status: number) => {
    const { log, operations } = harness(async () => {
      const { createOpenRouter } = await import('@daisy/ai-voice');
      return createOpenRouter({
        apiKey: 'k',
        fetch: async () => new Response('', { status }),
      }).complete({ model: 'm', messages: [], maxTokens: 1 });
    });
    await operations.executeClaim(claim, new AbortController().signal);
    return log.failures[0]?.final;
  };
  assert({
    given: 'statuses 400, 404, 401, 402 and 403',
    should: 'end the job only on a refusal of the request',
    actual: [
      await refusedWith(400),
      await refusedWith(404),
      await refusedWith(401),
      await refusedWith(402),
      await refusedWith(403),
    ],
    expected: [true, true, false, false, false],
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
    expected: [{ category: 'provider_refused', final: false }],
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
    expected: [{ category: 'timeout', final: false }],
  });
});
