import { requireTestServices } from '@daisy/config';
import { createOpenRouter } from '@daisy/ai-voice';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createBotGeneration } from '../src/features/round-bots/generation';
import { createProviderBudget } from '../src/server/provider-budget';
import { withRoomRuntime } from './round-runtime.test-support';
import { opponentSpeech, botControlOptions } from './bot-control.test-support';
setupRitewayBun();
requireTestServices(process.env);
test('actual generation caller refuses opponent speech without dispatch or transcript credit', async () => {
  let calls = 0;
  await withRoomRuntime(async (f) => {
    const { roundId, claim } = await opponentSpeech(f);
    const generation = createBotGeneration({
      store: f.store,
      voice: () =>
        createOpenRouter({
          apiKey: 'unused-test-capability',
          fetch: async () => {
            calls++;
            throw Error('must not dispatch');
          },
        }),
      withProvider: createProviderBudget(1),
      nowMs: () => Date.now(),
      maxTokens: 1000,
    });
    await assertRejects({
      given: 'actual generation on the opponent actual speech',
      should: 'refuse before a provider call',
      actual: () =>
        generation.generate(
          claim.scope,
          claim.token,
          AbortSignal.timeout(5000),
        ),
      code: 'CONFLICT',
    });
    const [state] =
      await f.sql`select (select coalesce(sum(requests),0)::int from agent_runs where round_participant_id=${claim.scope.roundParticipantId}) requests,(select count(*)::int from utterances where round_id=${roundId}) lines`;
    assert({
      given: 'refused real feature generation',
      should: 'preserve zero requests and zero transcript lines',
      actual: [calls, state.requests, state.lines],
      expected: [0, 0, 0],
    });
  }, botControlOptions);
});
