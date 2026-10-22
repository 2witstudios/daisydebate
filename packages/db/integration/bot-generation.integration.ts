import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { withBotPublication } from './bot-publication.test-support';
import { admissionSponsor } from './bot-admission.test-support';
import { createRoundBotAdmission } from '../src/round-bot-admission';
setupRitewayBun();
requireTestServices(process.env);
test('actual bot generation fences speaking before admission and separately settles real call usage after terminal', async () => {
  await withBotPublication(
    async ({ fixture, run, target, operations }) => {
      const actorId = await admissionSponsor(fixture, [target.roundId]);
      const admission = createRoundBotAdmission({
        run,
        nextId: createId,
        busyCap: 4,
      });
      const reservation = await admission.reserve({
        roundId: target.roundId,
        actorId,
      });
      const claim = await operations.claimWorker(target);
      await fixture.sql`update round_speaking_intervals set ended_at=clock_timestamp(),ended_version=started_version where segment_id=${target.segmentId}`;
      await assertRejects({
        given: 'a fresh control worker without publication eligibility',
        should: 'refuse generation before counting or creating an execution',
        actual: () =>
          operations.beginGeneration(claim.scope, claim.token, {
            kind: 'language',
          }),
        code: 'CONFLICT',
      });
      const [before] =
        await fixture.sql`select counted_at,(select coalesce(sum(requests),0)::int from agent_runs where round_participant_id=${target.roundParticipantId}) requests from usage_reservations where id=${reservation.id}`;
      assert({
        given: 'a refused model request',
        should: 'preserve quota and execution counts',
        actual: [before.counted_at, before.requests],
        expected: [null, 0],
      });
      await fixture.sql`update round_speaking_intervals set ended_at=null,ended_version=null where segment_id=${target.segmentId}`;
      const call = await operations.beginGeneration(claim.scope, claim.token, {
        kind: 'language',
      });
      const [recorded] =
        await fixture.sql`select requests,configuration_snapshot from agent_runs where id=${call.execution.id}`;
      assert({
        given: 'an actual scoped allowed generation dispatch',
        should:
          'return the real seat profile/history/model and record one uncertain call without text credit',
        actual: [
          call.round.id,
          call.seat.id,
          call.profile.voice,
          call.model,
          call.utterances,
          recorded.requests,
          recorded.configuration_snapshot.providerOutcome,
          (
            await fixture.sql`select id from utterances where round_id=${target.roundId}`
          ).length,
        ],
        expected: [
          target.roundId,
          target.roundParticipantId,
          'aura-2-thalia-en',
          'anthropic/claude-sonnet-5.5',
          [],
          1,
          'unknown',
          0,
        ],
      });
      await assertRejects({
        given: 'an execution child presented as a publication controller',
        should: 'refuse any publication authority',
        actual: () =>
          operations.verifyBotPublication(
            {
              ...claim.scope,
              agentRunId: call.execution.id,
              serviceId: `agent-run:${call.execution.id}`,
            },
            call.execution.token,
          ),
        code: 'CONFLICT',
      });
      const [charged] =
        await fixture.sql`select counted_at is not null as counted from usage_reservations where id=${reservation.id}`;
      assert({
        given: 'the first admitted actual model dispatch',
        should: 'durably count the existing reservation once',
        actual: charged.counted,
        expected: true,
      });
      const voice = await operations.beginGeneration(claim.scope, claim.token, {
        kind: 'tts',
        characters: 8,
      });
      await assertRejects({
        given: 'a second call exceeding this seat speech budget',
        should: 'refuse before dispatch intent',
        actual: () =>
          operations.beginGeneration(claim.scope, claim.token, {
            kind: 'tts',
            characters: 3,
          }),
        code: 'CONFLICT',
      });
      const [voiceRun] =
        await fixture.sql`select kind,model,characters,requests from agent_runs where id=${voice.execution.id}`;
      assert({
        given: 'actual TTS admission',
        should: 'reserve this call text cost before vendor uncertainty',
        actual: [
          voiceRun.kind,
          voiceRun.model,
          voiceRun.characters,
          voiceRun.requests,
        ],
        expected: ['tts', 'deepgram/aura-2', 8, 1],
      });
      await fixture.sql`update rounds set status='abandoned',current_stage=null,completed_at=clock_timestamp() where id=${target.roundId}`;
      await operations.finishGeneration(
        claim.scope,
        voice.execution,
        'unknown',
        { inputTokens: 0, outputTokens: 0, characters: 8 },
      );
      const usage = { inputTokens: 11, outputTokens: 7, characters: 0 };
      await operations.finishGeneration(
        claim.scope,
        call.execution,
        'received',
        usage,
      );
      await operations.finishGeneration(
        claim.scope,
        call.execution,
        'received',
        usage,
      );
      await assertRejects({
        given: 'a changed repeat settlement',
        should: 'refuse rather than add or rewrite usage',
        actual: () =>
          operations.finishGeneration(claim.scope, call.execution, 'received', {
            ...usage,
            outputTokens: 8,
          }),
        code: 'CONFLICT',
      });
      await assertRejects({
        given: 'a foreign execution bearer',
        should: 'refuse usage settlement',
        actual: () =>
          operations.finishGeneration(
            claim.scope,
            { ...call.execution, token: 'x'.repeat(43) },
            'received',
            usage,
          ),
        code: 'AUTHORIZATION',
      });
      const [settled] =
        await fixture.sql`select requests,input_tokens,output_tokens,ended_at is not null as ended from agent_runs where id=${call.execution.id}`;
      assert({
        given: 'idempotent usage settlement after actual Round abandonment',
        should:
          'record actual counters without reopening or completing the Round',
        actual: [
          settled.requests,
          settled.input_tokens,
          settled.output_tokens,
          settled.ended,
          (
            await fixture.sql`select status from rounds where id=${target.roundId}`
          )[0].status,
        ],
        expected: [1, 11, 7, true, 'abandoned'],
      });
    },
    { ttsModel: 'deepgram/aura-2', speechBudget: 10 },
  );
});

test('TTS dispatch refuses missing explicit provider/budget policy', async () => {
  await withBotPublication(async ({ target, operations }) => {
    const claim = await operations.claimWorker(target);
    await assertRejects({
      given: 'no configured speech model or budget',
      should: 'refuse without inferred configuration',
      actual: () =>
        operations.beginGeneration(claim.scope, claim.token, {
          kind: 'tts',
          characters: 1,
        }),
      code: 'INFRASTRUCTURE',
    });
  });
});
