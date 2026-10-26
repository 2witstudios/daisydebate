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

test('a synthesized phrase carries its segment end to the publisher', async () => {
  const startedAt = '2026-10-23T10:00:00.000Z';
  const answer = await synthesizeOne({
    beginRoundBotGeneration: (async () => ({
      execution: 'execution',
      model: 'model',
      profile: { voice: 'voice' },
      round: {
        segments: [{ id: scope.segmentId, startedAt, durationMs: 60_000 }],
      },
    })) as never,
    finishRoundBotGeneration: async () => undefined,
    verifyRoundBotPublication: async () => undefined,
  });
  assert({
    given: 'a phrase synthesized for a segment that started at 10:00 for 60 s',
    should:
      'carry the scheduled end, 10:01, to the publisher clamp (ISSUE-460-r1)',
    actual: answer.value.segmentEndsAt,
    expected: '2026-10-23T10:01:00.000Z',
  });
});
