import { fixtureJudgingProgression } from './judging-progression.test-support';
import { setupRitewayBun, test, assert } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { judgingJobRules } from '@daisy/debate-engine';
import { canUseAiAllowance } from '@daisy/auth/authorization';
import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { createRoundJudgingJobs } from '../src/round-judging-jobs';
import {
  withJudgingJob,
  syntheticPendingBallot,
} from './round-judging.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('judging takeover requires its application progression to apply', () =>
  withJudgingJob(
    async ({ run, target }) => {
      const jobs = createRoundJudgingJobs({
        run,
        nextId: createId,
        nextToken: () => randomBytes(32).toString('base64url'),
        leaseMs: 30000,
        model: 'fixture-model',
        contractVersion: 'fixture-contract',
        rules: judgingJobRules,
        accountEligible: canUseAiAllowance,
        ...{ progression: async () => {} },
      });
      await assertRejects({
        given: 'the application returns without deciding the takeover',
        should: 'refuse rather than claim without its progression owner',
        actual: () => jobs.claim(target),
        code: 'CONFLICT',
      });
    },
    'complete',
    undefined,
    'first',
  ));

for (const kind of ['takeover', 'dispatch', 'record', 'failure'] as const)
  test(
    'released judging ' +
      kind +
      ' progression stays closed during actual SQL cleanup',
    () =>
      withJudgingJob(
        async ({ run, target, fixture, jobs }) => {
          const claim = await jobs.claim(target);
          if (kind === 'record' || kind === 'failure') {
            await jobs.beginModelCall(claim.scope, claim.token, 'first');
            await jobs.recordUsage(claim.scope, claim.token, {
              inputTokens: 11,
              outputTokens: 5,
            });
          }
          if (kind === 'takeover')
            await fixture.sql`update round_judging_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${target.roundId}`;
          let pending: Promise<void> | undefined;
          let released: (() => Promise<void>) | undefined;
          const guarded = createRoundJudgingJobs({
            run: (work, options) =>
              run(async (tx, signal, metadata) => {
                try {
                  return await work(tx, signal, metadata);
                } catch (error) {
                  // Deliberately keep the real transaction open while its unawaited SQL finishes.
                  if (pending) await Promise.allSettled([pending]);
                  if (released)
                    await assertRejects({
                      given:
                        kind + ' pending SQL finished after callback release',
                      should: 'keep the frame terminal before rollback',
                      actual: released,
                      code: 'CONFLICT',
                    });
                  throw error;
                }
              }, options),
            nextId: createId,
            nextToken: () => randomBytes(32).toString('base64url'),
            leaseMs: 30000,
            model: 'fixture-model',
            contractVersion: 'fixture-contract',
            rules: judgingJobRules,
            accountEligible: canUseAiAllowance,
            progression: (session) =>
              fixtureJudgingProgression({
                ...session,
                apply: async (decision) => {
                  if (session.kind !== kind) return session.apply(decision);
                  released = () => session.apply(decision);
                  pending = session.apply(decision);
                  void pending.catch(() => {});
                },
              }),
          });
          const snapshot = async () => {
            const [row] = await fixture.sql`select row_to_json(j)::text as job,
          (select json_agg(a order by a.id)::text from agent_runs a where round_participant_id=${target.judgeParticipantId}) as runs,
          (select json_agg(t order by t.agent_run_id)::text from round_judging_attempts t where round_id=${target.roundId}) as attempts
          from round_judging_jobs j where round_id=${target.roundId}`;
            return { ...row };
          };
          const before = await snapshot();
          await assertRejects({
            given: 'an unawaited ' + kind + ' apply',
            should: 'refuse incomplete progression',
            code: 'CONFLICT',
            actual: () =>
              kind === 'takeover'
                ? guarded.claim(target)
                : kind === 'dispatch'
                  ? guarded.beginModelCall(claim.scope, claim.token, 'first')
                  : kind === 'record'
                    ? guarded.saveStage(
                        claim.scope,
                        claim.token,
                        { stage: 'first', ballot: syntheticPendingBallot },
                        { inputTokens: 11, outputTokens: 5 },
                      )
                    : guarded.recordAttemptFailure(claim.scope, claim.token, {
                        diagnostic: {
                          category: 'schema_rejected',
                          finish: 'stop',
                          issueCount: 0,
                          issues: [],
                        },
                        final: false,
                      }),
          });
          assert({
            given: 'released ' + kind + ' with SQL cleanup completed',
            should:
              'retain exact original identities, stage and accounted rows',
            actual: await snapshot(),
            expected: before,
          });
        },
        'complete',
        undefined,
        'first',
      ),
  );

for (const kind of ['takeover', 'dispatch', 'record', 'failure'] as const)
  for (const mode of ['sequential', 'concurrent'] as const)
    test(
      'caught ' + mode + ' repeat invalidates judging ' + kind + ' atomically',
      () =>
        withJudgingJob(
          async ({ run, target, fixture, jobs }) => {
            const claim = await jobs.claim(target);
            if (kind === 'record' || kind === 'failure') {
              await jobs.beginModelCall(claim.scope, claim.token, 'first');
              await jobs.recordUsage(claim.scope, claim.token, {
                inputTokens: 11,
                outputTokens: 5,
              });
            }
            if (kind === 'takeover')
              await fixture.sql`update round_judging_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${target.roundId}`;
            const snapshot = async () => {
              const [row] =
                await fixture.sql`select row_to_json(j)::text as job,
            (select json_agg(a order by a.id)::text from agent_runs a where round_participant_id=${target.judgeParticipantId}) as runs,
            (select json_agg(t order by t.agent_run_id)::text from round_judging_attempts t where round_id=${target.roundId}) as attempts
            from round_judging_jobs j where round_id=${target.roundId}`;
              return { ...row };
            };
            const before = await snapshot();
            const guarded = createRoundJudgingJobs({
              run,
              nextId: createId,
              nextToken: () => randomBytes(32).toString('base64url'),
              leaseMs: 30000,
              model: 'fixture-model',
              contractVersion: 'fixture-contract',
              rules: judgingJobRules,
              accountEligible: canUseAiAllowance,
              progression: (session) =>
                fixtureJudgingProgression({
                  ...session,
                  apply: async (decision) => {
                    if (session.kind !== kind) return session.apply(decision);
                    if (mode === 'sequential') {
                      await session.apply(decision);
                      await Promise.allSettled([session.apply(decision)]);
                    } else
                      await Promise.allSettled([
                        session.apply(decision),
                        session.apply(decision),
                      ]);
                  },
                }),
            });
            await assertRejects({
              given:
                'the application catches its ' +
                mode +
                ' repeated ' +
                kind +
                ' apply error',
              should: 'still refuse the entire enclosing operation',
              code: 'CONFLICT',
              actual: () =>
                kind === 'takeover'
                  ? guarded.claim(target)
                  : kind === 'dispatch'
                    ? guarded.beginModelCall(claim.scope, claim.token, 'first')
                    : kind === 'record'
                      ? guarded.saveStage(
                          claim.scope,
                          claim.token,
                          { stage: 'first', ballot: syntheticPendingBallot },
                          { inputTokens: 11, outputTokens: 5 },
                        )
                      : guarded.recordAttemptFailure(claim.scope, claim.token, {
                          diagnostic: {
                            category: 'schema_rejected',
                            finish: 'stop',
                            issueCount: 0,
                            issues: [],
                          },
                          final: false,
                        }),
            });
            assert({
              given: 'caught ' + mode + ' repeated ' + kind + ' apply',
              should:
                'preserve exact original jobs, runs, attempts and separately accounted usage',
              actual: await snapshot(),
              expected: before,
            });
          },
          'complete',
          undefined,
          'first',
        ),
    );
