import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
import { createBotGeneration } from './generation';
import { scope } from './speaker.test-support';
setupRitewayBun();

/** Synthesizes one phrase through a generation over the given store and a fixed voice. */
const synthesizeOne = (
  store: Parameters<typeof createBotGeneration>[0]['store'],
) =>
  createBotGeneration({
    store,
    voice: () =>
      ({
        speakPcm: async () => ({
          pcm: new Int16Array(240),
          sampleRate: 24000,
          channels: 1,
          characters: 4,
        }),
      }) as never,
    withProvider: (_signal, work) => work(),
    nowMs: () => 0,
    maxTokens: 100,
  }).synthesize(
    scope,
    'token',
    'p'.repeat(24),
    'One.',
    new AbortController().signal,
  );

test('a refused settlement retried records the received usage once', async () => {
  const finished: string[] = [];
  let verifications = 0;
  const answer = await synthesizeOne({
    beginRoundBotGeneration: (async () => ({
      execution: 'execution',
      model: 'model',
      profile: { voice: 'voice' },
      round: { segments: [] },
    })) as never,
    finishRoundBotGeneration: async (_scope, _execution, outcome) => {
      finished.push(outcome);
    },
    verifyRoundBotPublication: async () => {
      if (++verifications === 1) throw refuseCapacity();
      return {
        segmentDueAt: '2026-10-23T10:01:00.000Z',
        now: new Date(0).toISOString(),
      };
    },
  });
  const first = await answer.settle().then(
    () => 'settled',
    () => 'refused',
  );
  await answer.settle();
  assert({
    given:
      'a synthesized phrase whose first settlement is refused at verification, then settled again',
    should: 'record the received usage once and verify twice',
    actual: { first, finished, verifications },
    expected: { first: 'refused', finished: ['received'], verifications: 2 },
  });
});

/** A language generation over a voice the test streams by hand. */
function streamedGeneration(options: { readonly budget?: () => void } = {}) {
  const finished: string[] = [];
  const requests: Record<string, unknown>[] = [];
  let hear: (text: string) => void = () => undefined;
  const answer = Promise.withResolvers<{
    text: string;
    finish: 'stop';
    refused: boolean;
    promptTokens: number;
    completionTokens: number;
  }>();
  const generation = createBotGeneration({
    store: {
      beginRoundBotGeneration: (async () => ({
        execution: 'execution',
        model: 'model',
        profile: { name: 'Bot', persona: '', difficulty: 'easy' },
        seat: { role: 'affirmative', slot: 0 },
        utterances: [],
        round: {
          resolution: 'Resolved.',
          participants: [],
          rules: { segments: [{ key: 'AC', label: 'Constructive' }] },
          segments: [
            {
              id: scope.segmentId,
              type: 'speech',
              rulesSegmentKey: 'AC',
              startedAt: new Date(0).toISOString(),
              durationMs: 60000,
              returnedMs: 0,
            },
          ],
        },
      })) as never,
      finishRoundBotGeneration: async (_scope, _execution, outcome, usage) => {
        finished.push(`${outcome}:${usage.outputTokens}`);
      },
      verifyRoundBotPublication: (async () => undefined) as never,
    },
    voice: () =>
      ({
        completeStreamed: async (
          request: Record<string, unknown>,
          onText: (text: string) => void,
        ) => {
          requests.push(request);
          hear = onText;
          return answer.promise;
        },
      }) as never,
    withProvider: async (_signal, work) => {
      options.budget?.();
      return work();
    },
    nowMs: () => 1000,
    maxTokens: 100,
  });
  const generate = () =>
    generation.generate(scope, 'token', new AbortController().signal, {
      kind: 'opening',
    });
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    generate,
    finished,
    requests,
    settle,
    hear: (text: string) => hear(text),
    answer,
  };
}

test('a speech answer opens with its first sentence and records its usage once, at its end', async () => {
  const { generate, finished, requests, hear, answer, settle } =
    streamedGeneration();
  const opening = generate();
  await settle();
  hear('Thank you, judge. I st');
  const opened = await opening;
  assert({
    given: 'a streamed answer whose first sentence has been written',
    should:
      'open with that phrase, ask for no reasoning and record no usage yet',
    actual: [
      opened.value.phrases.ready(0),
      opened.value.phrases.ended(),
      requests[0]?.['reasoning'],
      finished,
    ],
    expected: ['Thank you, judge.', false, 'none', []],
  });
  hear('and firmly against it.');
  answer.resolve({
    text: 'Thank you, judge. I stand firmly against it.',
    finish: 'stop',
    refused: false,
    promptTokens: 12,
    completionTokens: 9,
  });
  await settle();
  await opened.close();
  await opened.close();
  assert({
    given: 'the stream ending, then its close asked twice',
    should: 'give the rest as the second phrase and record received usage once',
    actual: [
      opened.value.phrases.ready(1),
      opened.value.phrases.ended(),
      opened.value.phrases.cutBy(),
      finished,
    ],
    expected: ['I stand firmly against it.', true, null, ['received:9']],
  });
});

test('a stream that breaks leaves its whole sentences standing; one that never starts is a failed call', async () => {
  const broken = streamedGeneration();
  const opening = broken.generate();
  await broken.settle();
  broken.hear('One. Two is whole. Three is unfini');
  const opened = await opening;
  broken.answer.reject(new Error('connection reset'));
  await broken.settle();
  assert({
    given: 'a stream that breaks mid-sentence after two whole sentences',
    should:
      'keep the whole sentences, drop the fragment, and settle the call unknown',
    actual: [
      opened.value.phrases.ready(0),
      opened.value.phrases.ready(1),
      await opened.value.phrases.at(2),
      opened.value.phrases.cutBy() !== null,
      broken.finished,
    ],
    expected: ['One.', 'Two is whole.', null, true, ['unknown:0']],
  });
  const unreachable = streamedGeneration();
  const failing = unreachable.generate();
  await unreachable.settle();
  unreachable.answer.reject(new Error('connection reset'));
  const refused = streamedGeneration({
    budget: () => {
      throw refuseCapacity();
    },
  });
  assert({
    given:
      'a stream that fails before any sentence, and a call refused before dispatch',
    should: 'reject both, settling only the dispatched one',
    actual: [
      await failing.then(
        () => 'opened',
        () => 'failed',
      ),
      unreachable.finished,
      await refused.generate().then(
        () => 'opened',
        () => 'refused',
      ),
      refused.finished,
    ],
    expected: ['failed', ['unknown:0'], 'refused', []],
  });
});
