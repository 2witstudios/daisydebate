import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isFinalBotSpeechRefusal } from '../src/bot-publication';
import { withGeneration } from './bot-generation.test-support';
setupRitewayBun();
requireTestServices(process.env);

const refusal = (work: () => Promise<unknown>) =>
  work().then(
    () => 'allowed',
    (error: unknown) =>
      isFinalBotSpeechRefusal(error) ? 'final' : 'retryable',
  );

test('a bot speech seat buys one received answer per segment, and a spent voice budget is final', async () => {
  await withGeneration(async ({ fixture, target, operations }) => {
    const claim = await operations.claimWorker(target);
    const call = await operations.beginGeneration(claim.scope, claim.token, {
      kind: 'language',
    });
    await operations.finishGeneration(claim.scope, call.execution, 'received', {
      inputTokens: 11,
      outputTokens: 7,
      characters: 0,
    });
    const requests = async () =>
      (
        await fixture.sql`select coalesce(sum(requests),0)::int requests from agent_runs where round_participant_id=${target.roundParticipantId}`
      )[0].requests;
    const before = await requests();
    const second = await refusal(() =>
      operations.beginGeneration(claim.scope, claim.token, {
        kind: 'language',
      }),
    );
    await operations.beginGeneration(claim.scope, claim.token, {
      kind: 'tts',
      characters: 8,
    });
    const overBudget = await refusal(() =>
      operations.beginGeneration(claim.scope, claim.token, {
        kind: 'tts',
        characters: 3,
      }),
    );
    assert({
      given:
        'a speech seat whose answer for this segment was received, then a voice budget spent to 8 of 10 characters',
      should:
        'refuse a second answer and a 3-character phrase as final, recording no new language request',
      actual: { second, overBudget, newRequests: (await requests()) - before },
      expected: { second: 'final', overBudget: 'final', newRequests: 1 },
    });
  });
});
