import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
import { createBotGeneration } from './generation';
setupRitewayBun();

const scope = {
  roundId: 'r'.repeat(24),
  roundParticipantId: 's'.repeat(24),
  segmentId: 'g'.repeat(24),
  agentRunId: 'a'.repeat(24),
  serviceId: 'agent-run:run',
  publicationEpoch: 1,
};

test('a refused settlement retried records the received usage once', async () => {
  const finished: string[] = [];
  let verifications = 0;
  const generation = createBotGeneration({
    store: {
      beginRoundBotGeneration: (async () => ({
        execution: 'execution',
        model: 'model',
        profile: { voice: 'voice' },
      })) as never,
      finishRoundBotGeneration: async (_scope, _execution, outcome) => {
        finished.push(outcome);
      },
      verifyRoundBotPublication: async () => {
        if (++verifications === 1) throw refuseCapacity();
      },
    },
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
  });
  const answer = await generation.synthesize(
    scope,
    'token',
    'p'.repeat(24),
    'One.',
    new AbortController().signal,
  );
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
