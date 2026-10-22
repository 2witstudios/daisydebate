import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { createOpenRouter } from '@daisy/ai-voice';
import { isAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { withRoomRuntime } from './round-runtime.test-support';
import { fixtureBallot, freezeBotJudge } from './round-judging.test-support';
import { createRoundJudgingOperations } from '../src/features/round-judging/operations';
import { createProviderCapacity } from '../src/features/round-bots/provider-capacity';
setupRitewayBun();
requireTestServices(process.env);
const ballot = fixtureBallot(
  'Controlled invalidation probe, not real provider evidence.',
);
for (const mode of ['terminal', 'invalid-ballot', 'http-error'] as const)
  test(`review judging known response accounting: ${mode}`, async () => {
    await withRoomRuntime(
      async (f) => {
        const { roundId, target } = await freezeBotJudge(f);
        const claim = await f.store.claimRoundJudgingJob(target);
        const readRun = () =>
          f.sql`select requests,input_tokens,output_tokens,configuration_snapshot->>'providerOutcome' as outcome from agent_runs where id=${claim.scope.agentRunId}`;
        const entered = Promise.withResolvers<void>(),
          release = Promise.withResolvers<void>();
        let calls = 0;
        const server = Bun.serve({
          hostname: '127.0.0.1',
          port: 0,
          fetch: async () => {
            calls++;
            entered.resolve();
            await release.promise;
            return mode === 'http-error'
              ? new Response(null, { status: 503 })
              : Response.json({
                  choices: [
                    {
                      message: {
                        content: JSON.stringify(
                          mode === 'invalid-ballot' ? {} : ballot,
                        ),
                      },
                    },
                  ],
                  usage: { prompt_tokens: 11, completion_tokens: 5 },
                });
          },
        });
        const voice = createOpenRouter({
          apiKey: 'noncredential-loopback-fixture',
          fetch: (_url, init) =>
            fetch(server.url, {
              ...init,
              headers: { 'content-type': 'application/json' },
            }),
        });
        const operation = createRoundJudgingOperations({
          store: f.store,
          nextId: createId,
          voice: () => voice,
          withProvider: createProviderCapacity(1),
        });
        const work = operation
          .executeClaim(claim, new AbortController().signal)
          .then(
            () => 'NO_REJECTION',
            (error) => (isAppError(error) ? error.code : 'OTHER_ERROR'),
          );
        try {
          await entered.promise;
          if (mode === 'terminal')
            await f.sql`update rounds set status='abandoned',current_stage=null,completed_at=clock_timestamp() where id=${roundId}`;
          release.resolve();
          const refusal = await work;
          const [run] = await readRun();
          if (mode !== 'http-error') {
            const usage = { inputTokens: 11, outputTokens: 5 };
            await f.store.recordRoundJudgingUsage(
              claim.scope,
              claim.token,
              usage,
            );
            await assertRejects({
              given: 'a foreign bearer retrying known response accounting',
              should: 'refuse without changing the original execution',
              actual: () =>
                f.store.recordRoundJudgingUsage(
                  claim.scope,
                  'x'.repeat(43),
                  usage,
                ),
              code: 'AUTHORIZATION',
            });
            await assertRejects({
              given: 'the original bearer with a changed command scope',
              should: 'refuse foreign execution accounting',
              actual: () =>
                f.store.recordRoundJudgingUsage(
                  { ...claim.scope, commandId: createId() },
                  claim.token,
                  usage,
                ),
              code: 'AUTHORIZATION',
            });
          }
          const [after] = await readRun();
          const [job] =
            await f.sql`select pending_ballot,status from round_judging_jobs where round_id=${roundId} and judge_participant_id=${target.judgeParticipantId}`;
          const [count] =
            await f.sql`select count(*)::int as n from ballots where round_id=${roundId}`;
          assert({
            given: `actual PG dispatch plus controlled loopback ${mode} response (not vendor acceptance)`,
            should:
              'refuse competitive submission, retain count, and record known usage before any retry even when no valid ballot may be cached',
            actual: {
              calls,
              refusal,
              requests: run.requests,
              usage: [run.input_tokens, run.output_tokens],
              outcome: run.outcome,
              ballots: count.n,
              cached: job.pending_ballot !== null,
              retryUnchanged:
                after.input_tokens === run.input_tokens &&
                after.output_tokens === run.output_tokens &&
                after.outcome === run.outcome,
            },
            expected: {
              calls: 1,
              refusal: mode === 'terminal' ? 'CONFLICT' : 'INFRASTRUCTURE',
              requests: 1,
              usage: mode === 'http-error' ? [0, 0] : [11, 5],
              outcome: mode === 'http-error' ? 'unknown' : 'received',
              ballots: 0,
              cached: false,
              retryUnchanged: true,
            },
          });
        } finally {
          release.resolve();
          await work;
          await server.stop(true);
        }
      },
      {
        botBusyCap: 4,
        judging: {
          leaseMs: 60000,
          model: 'fixture-model',
          nextToken: () => randomBytes(32).toString('base64url'),
        },
      },
    );
  });
