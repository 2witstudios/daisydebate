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

test('a speech that has said a line is never bought again, even with no answer recorded', async () => {
  await withGeneration(async ({ fixture, target, operations }) => {
    const claim = await operations.claimWorker(target);
    // A streamed answer is spoken before its usage is known: the worker was
    // lost with one line said and its call still recorded as unknown.
    const before = await refusal(() =>
      operations.beginGeneration(claim.scope, claim.token, {
        kind: 'language',
      }),
    );
    await fixture.sql`insert into utterances(id,round_id,segment_id,round_participant_id,sequence,text,complete,bot_phrase_id,bot_duration_ms)
      values(${'u'.repeat(24)},${target.roundId},${target.segmentId},${target.roundParticipantId},0,'My first point stands.',true,${'p'.repeat(24)},2000)`;
    const second = await refusal(() =>
      operations.beginGeneration(claim.scope, claim.token, {
        kind: 'language',
      }),
    );
    const voice = await refusal(() =>
      operations.beginGeneration(claim.scope, claim.token, {
        kind: 'tts',
        characters: 2,
      }),
    );
    assert({
      given:
        'a speech segment in which the seat authored a line while its one answer is still recorded unknown',
      should:
        'refuse a second language answer as final and still voice the phrases of the first',
      actual: { before, second, voice },
      expected: { before: 'allowed', second: 'final', voice: 'allowed' },
    });
  });
});
