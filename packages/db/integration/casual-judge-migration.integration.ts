import { SQL } from 'bun';
import { judgingPolicy } from '@daisy/protocol';
import { atFinalJudgingStage } from '../src/testing-judging';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { canUseAiAllowance } from '@daisy/auth/authorization';
import { judgingJobRules } from '@daisy/debate-engine';
import { usageStateSchema, usageSourceSchema } from '@daisy/protocol/billing';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { recordJudgingUsage } from '../src/round-judging-accounting';
import { createRoundJudgingJobs } from '../src/round-judging-jobs';
import { testLane } from '../src/testing-lane';
import { withFixture } from './constraint-helpers';
import { exportThenErase } from './privacy.test-support';
import { usagePrivacyAdopter } from '../src/usage-privacy';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
import {
  judgeCases,
  seedHistoricalJudge,
  originalAdmission,
  originalDispatch,
  originalAnswer,
  type JudgeCase,
} from './casual-judge-migration.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const predecessor = '20261107025259_round_floor_authority';
const migrationPath = new URL(
  '../migrations/20261107080513_fair_midnight/migration.sql',
  import.meta.url,
);
const source = {
  kind: 'beta',
  startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: '2026-11-01T00:00:00.000Z',
};

const judgingJobs = (run: ReturnType<typeof createBoundedTransaction>) =>
  createRoundJudgingJobs({
    run,
    nextId: createId,
    nextToken: () => randomBytes(32).toString('base64url'),
    leaseMs: 30_000,
    model: 'anthropic/claude-sonnet-5.5',
    contractVersion: 'fixture-contract',
    rules: judgingJobRules,
    accountEligible: canUseAiAllowance,
  });

test(
  'historical casual judge migration preserves frozen sponsor, original period and truthful dispatch without inventing relief',
  async () => {
    const scratch = scratchDatabase(databaseUrl, 'can7vbrip0jjudge');
    await scratch.create();
    try {
      await scratch.migrate((folder) => folder <= predecessor);
      await withFixture(scratch.url, async (f) => {
        const seeded: Awaited<ReturnType<typeof seedHistoricalJudge>>[] = [];
        try {
          for (const mode of judgeCases.filter((mode) => mode !== 'existing'))
            seeded.push(await seedHistoricalJudge(f, mode));
          const beforeMigration = Date.now();
          await scratch.migrate(() => true);
          const afterMigration = Date.now();
          // A judge debit cannot exist in main99; test existing-key retention on the final schema.
          seeded.push(await seedHistoricalJudge(f, 'existing'));
          const facts = [];
          for (const row of seeded) {
            const [usage] =
              await f.sql`select id,actor_id,source,state,reserved_at,binds_free_judge from usage_reservations where round_id=${row.roundId} and kind='casual_ai_judge'`;
            if (!usage) {
              facts.push([row.mode, null]);
              continue;
            }
            const state = usageStateSchema.parse(usage.state);
            facts.push([
              row.mode,
              usage.actor_id === row.actorId,
              usageSourceSchema.parse(usage.source),
              state.kind,
              'countedAt' in state
                ? row.mode === 'missing_attempt'
                  ? Date.parse(state.countedAt) >= beforeMigration &&
                    Date.parse(state.countedAt) <= afterMigration
                    ? 'migration_observation'
                    : 'invalid_observation'
                  : new Date(state.countedAt).toISOString()
                : null,
              'countBasis' in state ? state.countBasis : null,
              new Date(usage.reserved_at).toISOString(),
              usage.binds_free_judge,
              row.existingId === null || usage.id === row.existingId,
            ]);
          }
          const expectedStates: Partial<Record<JudgeCase, string>> = {
            reserved: 'reserved',
            terminal_undispatched: 'released',
            unknown: 'unknown',
            live_received: 'unknown',
            failed_unrestored: 'definite_failure',
            failed_retryable: 'unknown',
            invalid_received: 'delivered',
            invalid_unknown: 'unknown',
            host_changed: 'reserved',
            reconstructed: 'delivered',
            legacy_failed: 'definite_failure',
            mixed: 'unknown',
            uncorroborated_failed: 'released',
            deadline_only: 'released',
            late_unknown: 'unknown',
            missing_attempt: 'unknown',
            existing: 'reserved',
          };
          assert({
            given:
              'a populated predecessor spanning the UTC month boundary, including failed calls without refunds, changed hosts, erased and unrelated cohorts',
            should:
              'attribute only missing casual AI judges to their frozen human sponsor and original beta month, using actual dispatch evidence without inventing relief',
            actual: facts,
            expected: judgeCases.map((mode) => {
              const state = expectedStates[mode];
              if (!state) return [mode, null];
              const counted = state !== 'reserved' && state !== 'released';
              return [
                mode,
                true,
                mode === 'existing' ? { kind: 'lifetime' } : source,
                state,
                counted
                  ? mode === 'missing_attempt'
                    ? 'migration_observation'
                    : ['reconstructed', 'legacy_failed'].includes(mode)
                      ? originalAnswer
                      : originalDispatch
                  : null,
                counted ? 'historical_observation' : null,
                originalAdmission,
                false,
                true,
              ];
            }),
          });
          const late = seeded.find((row) => row.mode === 'late_unknown')!;
          if (!late.execution)
            throw Error('Expected original counted execution');
          const client = new SQL(scratch.url, { max: 4 });
          const run = createBoundedTransaction({
            lane: testLane(client, 4),
            now: performance.now,
          });
          try {
            await recordJudgingUsage(
              run,
              late.execution.scope,
              late.execution.token,
              { inputTokens: 9, outputTokens: 2 },
            );
            await recordJudgingUsage(
              run,
              late.execution.scope,
              late.execution.token,
              { inputTokens: 9, outputTokens: 2 },
            );
            const [resolved] =
              await f.sql`select source,state from usage_reservations where round_id=${late.roundId} and kind='casual_ai_judge'`;
            assert({
              given:
                'a migrated historical unknown with two identical authenticated late usage reports',
              should:
                'resolve served evidence once while retaining original observation basis and period without relief',
              actual: [
                resolved.source,
                resolved.state.kind,
                resolved.state.countBasis,
                new Date(resolved.state.countedAt).toISOString(),
              ],
              expected: [
                source,
                'delivered',
                'historical_observation',
                originalDispatch,
              ],
            });
          } finally {
            await client.close({ timeout: 0 });
          }
          const before = await f.sql<
            { id: string; kind: string; round_id: string }[]
          >`select * from usage_reservations order by id`;
          const identities = before.filter(
            (row) => row.kind === 'casual_ai_judge',
          );
          assert({
            given:
              'distinct frozen Round/sponsor fixtures, including the changed Room host and existing business-key identity',
            should:
              'derive only missing historical IDs from the exact namespace while preserving distinct and existing identities',
            actual: [
              new Set(identities.map((row) => row.id)).size,
              identities.map((row) => row.id),
            ],
            expected: [
              identities.length,
              identities.map((row) => {
                const seededRow = seeded.find(
                  (seed) => seed.roundId === row.round_id,
                )!;
                return (
                  seededRow.existingId ??
                  'm' +
                    createHash('sha256')
                      .update(
                        `casual_judge_usage:${seededRow.roundId}:${seededRow.actorId}`,
                      )
                      .digest('hex')
                      .slice(0, 23)
                );
              }),
            ],
          });
          const migration = await readFile(migrationPath, 'utf8');
          // Reapply exactly the one-off backfill statement, without rewriting schema/history.
          const backfill = migration
            .split('--> statement-breakpoint')
            .find((statement) =>
              statement.includes('-- Historical casual judge cohort'),
            );
          if (!backfill) throw Error('Expected historical cohort statement');
          await f.sql.unsafe(backfill);
          assert({
            given: 'repeat execution of the actual backfill',
            should: 'preserve every identity, state and source byte',
            actual: await f.sql`select * from usage_reservations order by id`,
            expected: before,
          });
          const closing = seeded.find((row) => row.mode === 'unknown')!;
          const [{ user_id: userId }] =
            await f.sql`select user_id from actors where id=${closing.actorId}`;
          const exported = await exportThenErase(
            drizzle({ client: f.sql }),
            { userId, actorId: closing.actorId },
            [usagePrivacyAdopter],
          );
          await f.sql.unsafe(backfill);
          assert({
            given:
              'actual account closure after historical identity creation, followed by the exact migration cohort replay',
            should:
              'export the original historical count and never resurrect its erased reservation',
            actual: [
              exported.usage_reservations!.map((row) => row.state),
              await f.count('usage_reservations', 'actor_id', closing.actorId),
            ],
            expected: [
              [
                {
                  kind: 'unknown',
                  countedAt: originalDispatch,
                  countBasis: 'historical_observation',
                },
              ],
              0,
            ],
          });
        } finally {
          for (const row of seeded)
            await f.sql`delete from rounds where id=${row.roundId}`;
        }
      });
    } finally {
      await scratch.drop();
    }
  },
  ddlTimeoutMs,
);

test(
  'a live migrated judge with a served call can dispatch later and settle unknown without restoring its old period',
  async () => {
    const scratch = scratchDatabase(databaseUrl, 'can7vbrip0jjudgelive');
    await scratch.create();
    try {
      await scratch.migrate((folder) => folder <= predecessor);
      await withFixture(scratch.url, async (f) => {
        const target = await seedHistoricalJudge(f, 'live_received');
        try {
          await scratch.migrate(() => true);
          // A historical job resumes at the final stage it always bought (ADR 0125).
          await atFinalJudgingStage(f.sql, target);
          const client = new SQL(scratch.url, { max: 4 });
          const run = createBoundedTransaction({
            lane: testLane(client, 4),
            now: performance.now,
          });
          const jobs = judgingJobs(run);
          try {
            const claimed = await jobs.claim(target);
            await jobs.beginModelCall(claimed.scope, claimed.token, 'final');
            await jobs.recordAttemptFailure(claimed.scope, claimed.token, {
              diagnostic: {
                category: 'timeout',
                finish: 'none',
                issueCount: 0,
                issues: [],
              },
              final: true,
            });
            const [after] =
              await f.sql`select source,state,(select sum(input_tokens)::int from agent_runs where round_participant_id=${target.judgeParticipantId}) as tokens
          from usage_reservations where round_id=${target.roundId} and kind='casual_ai_judge'`;
            assert({
              given:
                'a served call before migration followed by a real later dispatch with an unknown result',
              should:
                'retain prior served costs, original source/count and unknown exposure without a refund or terminal conflict',
              actual: [
                after?.source,
                after?.state.kind,
                after && new Date(after.state.countedAt).toISOString(),
                after?.state.countBasis,
                after?.tokens,
              ],
              expected: [
                source,
                'unknown',
                originalDispatch,
                'historical_observation',
                7,
              ],
            });
          } finally {
            await client.close({ timeout: 0 });
          }
        } finally {
          await f.sql`delete from rounds where id=${target.roundId}`;
        }
      });
    } finally {
      await scratch.drop();
    }
  },
  ddlTimeoutMs,
);

test(
  'counter-only historical judge calls retain provider budget after migration',
  async () => {
    const scratch = scratchDatabase(databaseUrl, 'can7vbrip0jjudgebudget');
    await scratch.create();
    try {
      await scratch.migrate((folder) => folder <= predecessor);
      await withFixture(scratch.url, async (f) => {
        const target = await seedHistoricalJudge(f, 'missing_attempt');
        try {
          await f.sql`update rounds set status='active',current_stage='live',completed_at=null where id=${target.roundId}`;
          await f.sql`update round_judging_jobs set status='queued',terminal_reason=null where round_id=${target.roundId}`;
          await f.sql`update agent_runs set requests=${judgingPolicy.maxPaidCalls} where round_participant_id=${target.judgeParticipantId}`;
          await scratch.migrate(() => true);
          // A historical job resumes at the final stage it always bought (ADR 0125).
          await atFinalJudgingStage(f.sql, target);
          const [before] =
            await f.sql`select id,actor_id,source,state,reserved_at,binds_free_judge from usage_reservations where round_id=${target.roundId}`;
          const client = new SQL(scratch.url, { max: 4 });
          const run = createBoundedTransaction({
            lane: testLane(client, 4),
            now: performance.now,
          });
          try {
            const jobs = judgingJobs(run);
            const claimed = await jobs.claim(target);
            const begun = await jobs.beginModelCall(
              claimed.scope,
              claimed.token,
              'final',
            );
            const [after] =
              await f.sql`select id,actor_id,source,state,reserved_at,binds_free_judge,(select sum(requests)::int from agent_runs where round_participant_id=${target.judgeParticipantId}) as requests,
            (select count(*)::int from round_judging_attempts where round_id=${target.roundId}) as attempts from usage_reservations where round_id=${target.roundId}`;
            const [pending] =
              await f.sql`select status,recovery_reason,terminal_reason,
              retry_at>clock_timestamp() and retry_at<=clock_timestamp()+interval '30 seconds' as bounded_backoff,
              lease_token_digest is null and lease_expires_at is null as released_lease,
              (select requests=0 and ended_at is not null from agent_runs where id=${claimed.scope.agentRunId}) as no_new_dispatch
              from round_judging_jobs where round_id=${target.roundId}`;
            assert({
              given:
                'a window of durable prior judge requests with missing attempt records, migrated before a retry claim',
              should:
                'defer the spent window with bounded backoff and released capacity, preserving the original usage identity, historical budget and lack of new dispatch or relief',
              actual: [begun, after, pending],
              expected: [
                { kind: 'deferred', reason: 'attempt_window' },
                {
                  ...before,
                  requests: judgingPolicy.maxPaidCalls,
                  attempts: 0,
                },
                {
                  status: 'recovering',
                  recovery_reason: 'attempt_window',
                  terminal_reason: null,
                  bounded_backoff: true,
                  released_lease: true,
                  no_new_dispatch: true,
                },
              ],
            });
          } finally {
            await client.close({ timeout: 0 });
          }
        } finally {
          await f.sql`delete from rounds where id=${target.roundId}`;
        }
      });
    } finally {
      await scratch.drop();
    }
  },
  ddlTimeoutMs,
);
