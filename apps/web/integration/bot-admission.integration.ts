import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import {
  isFinalBotSpeechRefusal,
  type BotGenerationSession,
  type BotClaimSession,
} from '@daisy/db/bot-publication';
import { botAdmission } from '../src/features/round-bots/admission';
import { withRoomRuntime } from './round-runtime.test-support';
import { ownSpeech, botControlOptions } from './bot-control.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('actual language and TTS admission roll back failed bound execution and refuse released capabilities', async () => {
  for (const kind of ['language', 'tts'] as const) {
    let fault: 'none' | 'refusal' | 'exception' | 'missing' | 'repeat' = 'none';
    let escaped: BotGenerationSession | undefined;
    await withRoomRuntime(
      async (f) => {
        const { roundId, claim } = await ownSpeech(f);
        for (const failure of [
          'refusal',
          'exception',
          'missing',
          'repeat',
        ] as const) {
          fault = failure;
          await assertRejects({
            given: kind + ' ' + failure + ' after application admission',
            should: 'roll back reservation and execution together',
            actual: () =>
              f.store.beginRoundBotGeneration(
                claim.scope,
                claim.token,
                kind === 'language' ? { kind } : { kind, characters: 5 },
              ),
            code:
              failure === 'refusal'
                ? 'AUTHORIZATION'
                : failure === 'exception'
                  ? 'INFRASTRUCTURE'
                  : 'CONFLICT',
          });
          const [row] = await f.sql`select
      (select coalesce(sum(requests),0)::int from agent_runs where round_participant_id=${claim.scope.roundParticipantId}) as requests,
      (select count(*)::int from usage_reservations where round_id=${roundId} and state->>'countedAt' is not null) as counted,
      (select count(*)::int from agent_runs where round_participant_id=${claim.scope.roundParticipantId} and configuration_snapshot ? 'parentAgentRunId') as executions`;
          assert({
            given: kind + ' ' + failure,
            should: 'leave no provider dispatch or counted usage',
            actual: { ...row },
            expected: { requests: 0, counted: 0, executions: 0 },
          });
          const released = escaped;
          if (!released) throw new Error('Generation frame required');
          await assertRejects({
            given: 'released generation reads',
            should: 'refuse before querying',
            actual: () => released.readSpoken(),
            code: 'CONFLICT',
          });
          await assertRejects({
            given: 'released generation apply',
            should: 'refuse before writing',
            actual: () => released.apply('model'),
            code: 'CONFLICT',
          });
        }
      },
      {
        ...botControlOptions,
        botPublication: {
          ...botControlOptions.botPublication,
          ttsModel: 'explicit-tts',
          speechBudget: 10,
          generationAdmission: async (session) => {
            escaped = session;
            await botAdmission.generationAdmission({
              ...session,
              apply: async (model) => {
                if (fault === 'missing') return;
                await session.apply(model);
                if (fault === 'refusal') throw createAppError('AUTHORIZATION');
                if (fault === 'exception')
                  throw createAppError('INFRASTRUCTURE');
                if (fault === 'repeat') await session.apply(model);
              },
            });
          },
        },
      },
    );
  }
});

test('actual claim takeover rolls back application failure and keeps the previous control identity', async () => {
  let fail = false;
  let escaped: BotClaimSession | undefined;
  await withRoomRuntime(
    async (f) => {
      const { roundId, claim } = await ownSpeech(f);
      await f.sql`update round_bot_publications set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
      fail = true;
      await assertRejects({
        given:
          'an expired control claim and a failure after applying its successor',
        should: 'roll back takeover and prior-run closure',
        actual: () => f.store.claimRoundBotWorker(claim.scope),
        code: 'AUTHORIZATION',
      });
      const [row] =
        await f.sql`select p.agent_run_id,p.publication_epoch,a.ended_at from round_bot_publications p join agent_runs a on a.id=p.agent_run_id where p.round_id=${roundId}`;
      assert({
        given: 'the refused takeover',
        should: 'retain the exact old epoch/run and its unclosed accounting',
        actual: { ...row },
        expected: {
          agent_run_id: claim.scope.agentRunId,
          publication_epoch: claim.scope.publicationEpoch,
          ended_at: null,
        },
      });
      const released = escaped;
      if (!released) throw new Error('Claim frame required');
      await assertRejects({
        given: 'the released claim reader',
        should: 'refuse before any query',
        actual: () => released.readControl(),
        code: 'CONFLICT',
      });
    },
    {
      ...botControlOptions,
      botPublication: {
        ...botControlOptions.botPublication,
        claimAdmission: async (session) => {
          escaped = session;
          await botAdmission.claimAdmission(session);
          if (fail) throw createAppError('AUTHORIZATION');
        },
      },
    },
  );
});

test('actual generation rechecks leased authority after application admission and rolls back counted usage', async () => {
  for (const kind of ['language', 'tts'] as const) {
    let beforeApply: () => Promise<void> = async () => {};
    let entered = false;
    await withRoomRuntime(
      async (f) => {
        const { roundId, claim } = await ownSpeech(f);
        const [row] =
          await f.sql`update round_bot_publications set lease_expires_at=clock_timestamp()+interval '400 milliseconds' where round_id=${roundId} returning lease_expires_at`;
        beforeApply = async () => {
          entered = true;
          // Cross the actual PG lease boundary after initial verification, without renewing authority.
          await f.sql`select pg_sleep(greatest(0,extract(epoch from(${row.lease_expires_at}::timestamptz-clock_timestamp())))+0.002)`;
        };
        await assertRejects({
          given:
            kind + ' policy admitted while its canonical worker lease was live',
          should:
            'refuse after usage admission if that lease expired, rolling everything back',
          actual: () =>
            f.store.beginRoundBotGeneration(
              claim.scope,
              claim.token,
              kind === 'language' ? { kind } : { kind, characters: 5 },
            ),
          code: 'CONFLICT',
        });
        const [state] = await f.sql`select
    (select coalesce(sum(requests),0)::int from agent_runs where round_participant_id=${claim.scope.roundParticipantId}) as requests,
    (select count(*)::int from usage_reservations where round_id=${roundId} and state->>'countedAt' is not null) as counted`;
        assert({
          given: 'the lease expired after the application decision',
          should:
            'have actually reached application admission and leave no dispatch/charge',
          actual: { entered, ...state },
          expected: { entered: true, requests: 0, counted: 0 },
        });
      },
      {
        ...botControlOptions,
        botPublication: {
          ...botControlOptions.botPublication,
          ttsModel: 'explicit-tts',
          speechBudget: 10,
          generationAdmission: (session) =>
            botAdmission.generationAdmission({
              ...session,
              apply: async (model) => {
                await beforeApply();
                await session.apply(model);
              },
            }),
        },
      },
    );
  }
});

test('the actual generation owner never buys a received speech again after control takeover', async () => {
  await withRoomRuntime(async (f) => {
    const { roundId, claim } = await ownSpeech(f);
    const bought = await f.store.beginRoundBotGeneration(
      claim.scope,
      claim.token,
      { kind: 'language' },
    );
    await f.store.finishRoundBotGeneration(
      claim.scope,
      bought.execution,
      'received',
      { inputTokens: 1, outputTokens: 1, characters: 0 },
    );
    await f.sql`update round_bot_publications set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
    const successor = await f.store.claimRoundBotWorker(claim.scope);
    let final = false;
    await assertRejects({
      given: 'a received language answer and a real successor control claim',
      should:
        'refuse repurchase with the same terminal speech refusal the speaker consumes',
      code: 'CONFLICT',
      actual: async () => {
        try {
          await f.store.beginRoundBotGeneration(
            successor.scope,
            successor.token,
            { kind: 'language' },
          );
        } catch (error) {
          final = isFinalBotSpeechRefusal(error);
          throw error;
        }
      },
    });
    const [state] =
      await f.sql`select coalesce(sum(requests),0)::int as requests,count(*) filter(where configuration_snapshot ? 'parentAgentRunId')::int as executions from agent_runs where round_participant_id=${claim.scope.roundParticipantId}`;
    assert({
      given: 'the refused recovered speech',
      should:
        'keep its single original bought answer and terminal classification',
      actual: { final, ...state },
      expected: { final: true, requests: 1, executions: 1 },
    });
  }, botControlOptions);
});
