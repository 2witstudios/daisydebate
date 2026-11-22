import { canUseAiAllowance } from '@daisy/auth/authorization';
import { createOpenRouter } from '@daisy/ai-voice';
import { syntheticCaseMap } from '@daisy/db/testing';
import { judgingJobRules } from '@daisy/debate-engine';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError, isAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { JudgingProgression } from '@daisy/db/round-judging-jobs';
import { judgingProgression } from '../src/features/round-judging/progression';
import { createRoundJudgingOperations } from '../src/features/round-judging/operations';
import { withRoomRuntime } from './round-runtime.test-support';
import { fixtureBallot, freezeBotJudge } from './round-judging.test-support';
import { botAdmissionForTests } from './bot-admission.test-support';
setupRitewayBun();
requireTestServices(process.env);
const ballot = fixtureBallot(
  'Controlled coherency progression, not live-provider proof.',
);
const usage = { inputTokens: 11, outputTokens: 5 };
const options = (progression: JudgingProgression = judgingProgression) => ({
  ...botAdmissionForTests,
  judging: {
    leaseMs: 60000,
    model: 'fixture-model',
    nextToken: () => randomBytes(32).toString('base64url'),
    contractVersion: 'fixture-contract',
    rules: judgingJobRules,
    progression,
    accountEligible: canUseAiAllowance,
  },
});

test('actual judging buys first, map and final once, then keeps the original held answer across takeover', () =>
  withRoomRuntime(async (f) => {
    const { roundId, target } = await freezeBotJudge(f);
    let calls = 0;
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => {
        const answer = calls++ === 1 ? syntheticCaseMap : ballot;
        return Response.json({
          choices: [{ message: { content: JSON.stringify(answer) } }],
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
    const operations = createRoundJudgingOperations({
      store: f.store,
      nextId: createId,
      voice: () => voice,
      withProvider: async (_signal, work) => work(),
    });
    const claims = [];
    try {
      for (const stage of ['first', 'map', 'final'] as const) {
        const claim = await f.store.claimRoundJudgingJob(target);
        claims.push(claim);
        const progress = (
          await f.store.verifyRoundJudgingJob(claim.scope, claim.token)
        ).progress;
        assert({
          given: 'the actual worker claimed ' + stage,
          should: 'read exactly its due stage',
          actual: progress.kind === 'stage_due' && progress.due.stage,
          expected: stage,
        });
        if (stage === 'final')
          await assertRejects({
            given: 'the final answer with unresolved actual attendance',
            should: 'hold its accounted ballot when submission refuses',
            actual: () =>
              operations.executeClaim(claim, new AbortController().signal),
            code: 'CONFLICT',
          });
        else await operations.executeClaim(claim, new AbortController().signal);
      }
      const original = claims[2]!;
      const [before] =
        await f.sql`select pending_ballot_agent_run_id,pending_ballot_epoch,pending_ballot_received_at::text as stamp from round_judging_jobs where round_id=${roundId}`;
      await f.sql`update round_judging_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
      const recovered = await f.store.claimRoundJudgingJob(target);
      await assertRejects({
        given: 'a held ballot on a takeover',
        should: 'retry only shared submission without buying any stage',
        actual: () =>
          operations.executeClaim(recovered, new AbortController().signal),
        code: 'CONFLICT',
      });
      const [after] =
        await f.sql`select pending_ballot_agent_run_id,pending_ballot_epoch,pending_ballot_received_at::text as stamp from round_judging_jobs where round_id=${roundId}`;
      const attempts = (
        await f.sql`select agent_run_id,job_epoch,stage,outcome,answered_at is not null as answered from round_judging_attempts where round_id=${roundId} order by job_epoch`
      ).map(
        (row: {
          agent_run_id: string;
          job_epoch: number;
          stage: string;
          outcome: string;
          answered: boolean;
        }) => ({ ...row }),
      );
      assert({
        given:
          'three actual loopback-provider stages and a held-answer takeover',
        should:
          'retain original persisted attempt identities, usage and exact cache stamp without a fourth provider call',
        actual: {
          calls,
          attempts,
          cache: { ...after },
          sameStamp: JSON.stringify(before) === JSON.stringify(after),
        },
        expected: {
          calls: 3,
          attempts: claims.map((claim, index) => ({
            agent_run_id: claim.scope.agentRunId,
            job_epoch: claim.scope.jobEpoch,
            stage: ['first', 'map', 'final'][index],
            outcome: 'succeeded',
            answered: true,
          })),
          cache: {
            ...before,
            pending_ballot_agent_run_id: original.scope.agentRunId,
            pending_ballot_epoch: original.scope.jobEpoch,
          },
          sameStamp: true,
        },
      });
    } finally {
      await server.stop(true);
    }
  }, options()));

test('actual lost-first takeover rolls back on application refusal and never repeats the original attempt', async () => {
  let refuse = false;
  await withRoomRuntime(
    async (f) => {
      const { roundId, target } = await freezeBotJudge(f);
      const first = await f.store.claimRoundJudgingJob(target);
      await f.store.beginRoundJudgingModelCall(
        first.scope,
        first.token,
        'first',
      );
      const [original] =
        await f.sql`select *,created_at::text as stamp from round_judging_attempts where agent_run_id=${first.scope.agentRunId}`;
      await f.sql`update round_judging_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
      refuse = true;
      await assertRejects({
        given:
          'application refusal after a real lost-first takeover was applied',
        should: 'roll back its run, epoch and spent-first marker atomically',
        actual: () => f.store.claimRoundJudgingJob(target),
        code: 'CONFLICT',
      });
      const [rolled] =
        await f.sql`select attempts,first_ballot_failed,(select count(*)::int from agent_runs where round_participant_id=${target.judgeParticipantId}) as runs from round_judging_jobs where round_id=${roundId}`;
      assert({
        given: 'the refused takeover',
        should: 'retain only the original claim and its unspent state',
        actual: { ...rolled },
        expected: { attempts: 1, first_ballot_failed: false, runs: 1 },
      });
      refuse = false;
      const next = await f.store.claimRoundJudgingJob(target);
      await assertRejects({
        given: 'the original expired first-pass worker',
        should: 'refuse stale stage storage',
        actual: () =>
          f.store.saveRoundJudgingStage(
            first.scope,
            first.token,
            { stage: 'first', ballot },
            usage,
          ),
        code: 'CONFLICT',
      });
      await assertRejects({
        given: 'the new worker after losing its predecessor first try',
        should: 'never repurchase first',
        actual: () =>
          f.store.beginRoundJudgingModelCall(next.scope, next.token, 'first'),
        code: 'CONFLICT',
      });
      const [after] =
        await f.sql`select *,created_at::text as stamp from round_judging_attempts where agent_run_id=${first.scope.agentRunId}`;
      // Known provider accounting remains independently durable even though stale stage storage refused.
      assert({
        given: 'the original bearer reporting usage after lost-first takeover',
        should:
          'retain original dispatch identity and receipt while recording only its known usage',
        actual: {
          identity: [
            after.agent_run_id,
            after.job_epoch,
            after.stage,
            after.stamp,
          ],
          original: [
            original.agent_run_id,
            original.job_epoch,
            original.stage,
            original.stamp,
          ],
          answered: after.answered_at !== null,
          due: (await f.store.verifyRoundJudgingJob(next.scope, next.token))
            .progress,
        },
        expected: {
          identity: [
            original.agent_run_id,
            original.job_epoch,
            original.stage,
            original.stamp,
          ],
          original: [
            original.agent_run_id,
            original.job_epoch,
            original.stage,
            original.stamp,
          ],
          answered: true,
          due: { kind: 'stage_due', due: { stage: 'map' } },
        },
      });
    },
    options(async (session) => {
      await judgingProgression(session);
      if (refuse && session.kind === 'takeover')
        throw createAppError('CONFLICT');
    }),
  );
});

test('judging dispatch rechecks the native lease after application progression waits', async () => {
  let wait: (() => Promise<void>) | undefined;
  let entered = false;
  await withRoomRuntime(
    async (f) => {
      const { roundId, target } = await freezeBotJudge(f);
      const claim = await f.store.claimRoundJudgingJob(target);
      await f.sql`update round_judging_jobs set lease_expires_at=clock_timestamp()+interval '400 milliseconds' where round_id=${roundId}`;
      wait = async () => {
        await f.sql`select pg_sleep(greatest(0,extract(epoch from lease_expires_at-clock_timestamp())::double precision)+0.02) from round_judging_jobs where round_id=${roundId}`;
      };
      await assertRejects({
        given: 'a driver entered alive but delayed beyond the real PG lease',
        should: 'refuse before dispatch accounting and attempt writes',
        actual: () =>
          f.store.beginRoundJudgingModelCall(claim.scope, claim.token, 'first'),
        code: 'CONFLICT',
      });
      const [row] =
        await f.sql`select requests,(select count(*)::int from round_judging_attempts where round_id=${roundId}) as attempts from agent_runs where id=${claim.scope.agentRunId}`;
      assert({
        given: 'the native lease lapse after the app was entered',
        should: 'buy no provider call',
        actual: { entered, ...row },
        expected: { entered: true, requests: 0, attempts: 0 },
      });
    },
    options(async (session) => {
      if (session.kind === 'dispatch' && wait) {
        entered = true;
        await wait();
      }
      await judgingProgression(session);
    }),
  );
});

for (const kind of ['takeover', 'dispatch', 'record', 'failure'] as const)
  test(
    'actual judging ' +
      kind +
      ' refuses partial or released progression without losing accounted identity',
    async () => {
      let attack:
        | 'none'
        | 'refuse'
        | 'exception'
        | 'missing'
        | 'repeat'
        | 'caught-repeat'
        | 'caught-concurrent' = 'none';
      let released: (() => Promise<void>) | undefined;
      await withRoomRuntime(
        async (f) => {
          const { roundId, target } = await freezeBotJudge(f);
          const claim = await f.store.claimRoundJudgingJob(target);
          if (kind === 'record' || kind === 'failure') {
            await f.store.beginRoundJudgingModelCall(
              claim.scope,
              claim.token,
              'first',
            );
            await f.store.recordRoundJudgingUsage(
              claim.scope,
              claim.token,
              usage,
            );
          }
          if (kind === 'takeover')
            await f.sql`update round_judging_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
          const snapshot = async () => {
            const [row] = await f.sql`select row_to_json(j)::text as job,
          (select json_agg(a order by a.id)::text from agent_runs a where round_participant_id=${target.judgeParticipantId}) as runs,
          (select json_agg(t order by t.agent_run_id)::text from round_judging_attempts t where round_id=${roundId}) as attempts
          from round_judging_jobs j where round_id=${roundId}`;
            return { ...row };
          };
          const before = await snapshot();
          const request = () =>
            kind === 'takeover'
              ? f.store.claimRoundJudgingJob(target)
              : kind === 'dispatch'
                ? f.store.beginRoundJudgingModelCall(
                    claim.scope,
                    claim.token,
                    'first',
                  )
                : kind === 'record'
                  ? f.store.saveRoundJudgingStage(
                      claim.scope,
                      claim.token,
                      { stage: 'first', ballot },
                      usage,
                    )
                  : f.store.recordRoundJudgingAttemptFailure(
                      claim.scope,
                      claim.token,
                      {
                        diagnostic: {
                          category: 'schema_rejected',
                          finish: 'stop',
                          issueCount: 0,
                          issues: [],
                        },
                        final: false,
                      },
                    );
          for (const mode of [
            'refuse',
            'exception',
            'missing',
            'repeat',
            'caught-repeat',
            'caught-concurrent',
          ] as const) {
            attack = mode;
            const code = await request().then(
              () => 'NO_REJECTION',
              (error) =>
                isAppError(error)
                  ? error.code
                  : error instanceof Error
                    ? error.message
                    : 'OTHER',
            );
            assert({
              given: kind + ' app driver ' + mode,
              should:
                'refuse and roll back every local effect while preserving exact original rows and accounting',
              actual: { code, rows: await snapshot() },
              expected: {
                code: mode === 'exception' ? 'INFRASTRUCTURE' : 'CONFLICT',
                rows: before,
              },
            });
            if (released)
              await assertRejects({
                given: kind + ' escaped apply after ' + mode,
                should: 'remain closed',
                actual: released,
                code: 'CONFLICT',
              });
          }
          if (kind === 'failure') {
            attack = 'none';
            await request();
            const [stored] =
              await f.sql`select first_ballot_failed,(select outcome from round_judging_attempts where agent_run_id=${claim.scope.agentRunId}) as outcome from round_judging_jobs where round_id=${roundId}`;
            assert({
              given: 'the actual application accepting the first-pass failure',
              should:
                'spend its one try and retain the failed original attempt',
              actual: { ...stored },
              expected: { first_ballot_failed: true, outcome: 'failed' },
            });
          }
        },
        options(async (session) => {
          if (session.kind !== kind || attack === 'none')
            return judgingProgression(session);
          if (attack === 'refuse') throw createAppError('CONFLICT');
          await judgingProgression({
            ...session,
            apply: async (decision) => {
              released = () => session.apply(decision);
              if (attack === 'missing') return;
              if (attack === 'caught-concurrent') {
                await Promise.allSettled([
                  session.apply(decision),
                  session.apply(decision),
                ]);
                return;
              }
              await session.apply(decision);
              if (attack === 'caught-repeat')
                await Promise.allSettled([session.apply(decision)]);
              if (attack === 'exception')
                throw Error('controlled post-apply exception');
              if (attack === 'repeat') await session.apply(decision);
            },
          });
        }),
      );
    },
  );

test('judging progression waits cannot extend the native generation window', async () => {
  let wait: (() => Promise<void>) | undefined;
  let entered = false;
  await withRoomRuntime(
    async (f) => {
      const { roundId, target } = await freezeBotJudge(f);
      const claim = await f.store.claimRoundJudgingJob(target);
      await f.sql`update round_judging_jobs set generation_deadline_at=clock_timestamp()+interval '400 milliseconds' where round_id=${roundId}`;
      wait = async () => {
        await f.sql`select pg_sleep(greatest(0,extract(epoch from generation_deadline_at-clock_timestamp())::double precision)+0.02) from round_judging_jobs where round_id=${roundId}`;
      };
      const result = await f.store.beginRoundJudgingModelCall(
        claim.scope,
        claim.token,
        'first',
      );
      const [row] =
        await f.sql`select requests,(select count(*)::int from round_judging_attempts where round_id=${roundId}) as attempts from agent_runs where id=${claim.scope.agentRunId}`;
      assert({
        given:
          'an alive claim whose application wait crosses the actual generation deadline',
        should:
          'use the existing bounded-window recovery without buying another call',
        actual: { entered, result, ...row },
        expected: {
          entered: true,
          result: { kind: 'deferred', reason: 'attempt_window' },
          requests: 0,
          attempts: 0,
        },
      });
    },
    options(async (session) => {
      if (session.kind === 'dispatch' && wait) {
        entered = true;
        await wait();
      }
      await judgingProgression(session);
    }),
  );
});

test('actual concurrent stage dispatch admits one persisted attempt for the claimed run', () =>
  withRoomRuntime(async (f) => {
    const { roundId, target } = await freezeBotJudge(f);
    const claim = await f.store.claimRoundJudgingJob(target);
    const outcomes = await Promise.allSettled([
      f.store.beginRoundJudgingModelCall(claim.scope, claim.token, 'first'),
      f.store.beginRoundJudgingModelCall(claim.scope, claim.token, 'first'),
    ]);
    const rows =
      await f.sql`select agent_run_id,job_epoch,model,contract_version,stage,outcome from round_judging_attempts where round_id=${roundId}`;
    assert({
      given:
        'two actual callers dispatching the same claimed stage concurrently',
      should: 'buy one original run/epoch/model/contract-bound attempt',
      actual: {
        outcomes: outcomes.map((o) => o.status).sort(),
        rows: Array.from(rows),
      },
      expected: {
        outcomes: ['fulfilled', 'rejected'],
        rows: [
          {
            agent_run_id: claim.scope.agentRunId,
            job_epoch: claim.scope.jobEpoch,
            model: claim.model,
            contract_version: 'fixture-contract',
            stage: 'first',
            outcome: 'dispatched',
          },
        ],
      },
    });
  }, options()));
