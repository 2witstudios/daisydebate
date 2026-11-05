import { SQL } from 'bun';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
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
const predecessor = '20261105041923_billing_usage_restoration';
const migrationPath = new URL(
  '../migrations/20261105051949_casual_judge_usage/migration.sql',
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
    const scratch = scratchDatabase(databaseUrl, 'billingjudge');
    await scratch.create();
    try {
      await scratch.migrate((folder) => folder <= predecessor);
      await withFixture(scratch.url, async (f) => {
        const seeded = [];
        try {
          for (const mode of judgeCases)
            seeded.push(await seedHistoricalJudge(f, mode));
          const beforeMigration = Date.now();
          await scratch.migrate(() => true);
          const afterMigration = Date.now();
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
          const before =
            await f.sql`select * from usage_reservations order by id`;
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
    const scratch = scratchDatabase(databaseUrl, 'billingjudgelive');
    await scratch.create();
    try {
      await scratch.migrate((folder) => folder <= predecessor);
      await withFixture(scratch.url, async (f) => {
        const target = await seedHistoricalJudge(f, 'live_received');
        try {
          await scratch.migrate(() => true);
          const client = new SQL(scratch.url, { max: 4 });
          const run = createBoundedTransaction({
            lane: testLane(client, 4),
            now: performance.now,
          });
          const jobs = judgingJobs(run);
          try {
            const claimed = await jobs.claim(target);
            await jobs.beginModelCall(claimed.scope, claimed.token);
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
    const scratch = scratchDatabase(databaseUrl, 'billingjudgebudget');
    await scratch.create();
    try {
      await scratch.migrate((folder) => folder <= predecessor);
      await withFixture(scratch.url, async (f) => {
        const target = await seedHistoricalJudge(f, 'missing_attempt');
        try {
          await f.sql`update rounds set status='active',current_stage='live',completed_at=null where id=${target.roundId}`;
          await f.sql`update round_judging_jobs set status='queued',terminal_reason=null where round_id=${target.roundId}`;
          await f.sql`update agent_runs set requests=2 where round_participant_id=${target.judgeParticipantId}`;
          await scratch.migrate(() => true);
          const [before] =
            await f.sql`select source,state from usage_reservations where round_id=${target.roundId}`;
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
            );
            const [after] =
              await f.sql`select source,state,(select sum(requests)::int from agent_runs where round_participant_id=${target.judgeParticipantId}) as requests,
            (select count(*)::int from round_judging_attempts where round_id=${target.roundId}) as attempts from usage_reservations where round_id=${target.roundId}`;
            assert({
              given:
                'two durable prior judge requests with missing attempt records, migrated before a retry claim',
              should:
                'end at the existing provider budget without a new dispatch, relief or changed recognition/source',
              actual: [begun, after],
              expected: [
                { kind: 'ended', reason: 'attempts_exhausted' },
                { ...before, requests: 2, attempts: 0 },
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
