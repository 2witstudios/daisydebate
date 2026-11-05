import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { admitAllowance, canUseAiAllowance } from '@daisy/auth/authorization';
import { analysisWorkSchema, type AnalysisWork } from '@daisy/protocol';
import { sampleRoundAnalysisReport as report } from '@daisy/protocol/round-analysis-testing';
import { assertRejects } from '@daisy/errors/testing';
import { withFixture, type Fixture } from './constraint-helpers';
import {
  scratchDatabase,
  ddlTimeoutMs,
} from './scratch-migrations.test-support';
import { completedRound } from './round-analysis.test-support';
import { createDatabase } from '../src';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const migration = '20261105082020_requested_round_analysis';
const scratch = scratchDatabase(databaseUrl, 'analysisrequest');
afterAll(() => scratch.drop());
const originalTime = new Date('2026-10-31T23:59:58.123Z');
const completion = new Date('2026-11-01T00:00:00.456Z');
const oldDigest = 'f'.repeat(64);
const cohorts = [
  {
    status: 'leased',
    attempts: 1,
    model: 'original-model',
    input: 0,
    output: 0,
  },
  {
    status: 'leased',
    attempts: 1,
    model: 'original-model',
    input: 100,
    output: 20,
  },
  {
    status: 'leased',
    attempts: 2,
    model: 'original-model',
    input: 100,
    output: 20,
  },
  {
    status: 'leased',
    attempts: 3,
    model: 'original-model',
    input: 0,
    output: 0,
  },
  {
    status: 'succeeded',
    attempts: 2,
    model: 'original-model',
    input: 100,
    output: 20,
  },
  {
    status: 'failed',
    attempts: 1,
    model: 'original-model',
    input: 0,
    output: 0,
  },
  {
    status: 'failed',
    attempts: 2,
    model: 'original-model',
    input: 100,
    output: 20,
  },
  { status: 'failed', attempts: 1, model: 'erased', input: 0, output: 0 },
] as const;
async function seed(f: Fixture, cohort: (typeof cohorts)[number]) {
  const roundId = await f.round();
  const { aff } = await completedRound(f, roundId, true);
  await f.insert('round_analyses', {
    round_id: roundId,
    round_participant_id: aff.id,
    freeze_revision: 1,
    status: cohort.status,
    attempts: cohort.attempts,
    model: cohort.model,
    input_tokens: cohort.input,
    output_tokens: cohort.output,
    lease_token_digest: cohort.status === 'leased' ? oldDigest : null,
    lease_expires_at:
      cohort.status === 'leased' ? new Date('2099-01-01T00:00:00Z') : null,
    report: cohort.status === 'succeeded' ? report : null,
    created_at: originalTime,
    completed_at: cohort.status === 'leased' ? null : completion,
  });
  return { roundId, roundParticipantId: aff.id, actorId: aff.actorId, cohort };
}
const storeOptions = {
  nextActorId: createId,
  roundAnalysis: {
    nextToken: () => randomBytes(32).toString('base64url'),
    model: 'new-model',
    leaseMs: 30_000,
    capacity: 8,
  },
  aiAllowance: {
    accountEligible: canUseAiAllowance,
    decide: ((account, facts, request, now) =>
      admitAllowance(account, facts, request, {
        now,
        betaGrantsPremium: true,
        betaMonthlyCap: 5,
      })) satisfies NonNullable<
      Parameters<typeof createDatabase>[0]['aiAllowance']
    >['decide'],
  },
};

test(
  'populated automatic analysis migrates without invented requests, dispatch, relief or reusable terminal identities',
  async () => {
    await scratch.create();
    await scratch.migrate((tag) => tag < migration);
    await withFixture(scratch.url, async (f) => {
      const originals = [];
      for (const cohort of cohorts) originals.push(await seed(f, cohort));
      await scratch.migrate(() => true);
      const snapshot = () =>
        f.sql<
          {
            round_id: string;
            round_participant_id: string;
            freeze_revision: number;
            work: AnalysisWork;
            created_at: Date;
          }[]
        >`select round_id,round_participant_id,freeze_revision,work,created_at from round_analyses order by round_participant_id`;
      const migrated = await snapshot();
      for (const original of originals) {
        const row = migrated.find(
          (row) => row.round_participant_id === original.roundParticipantId,
        )!;
        const state = analysisWorkSchema.parse(row.work);
        const history = state.historical!;
        assert({
          given: `a populated predecessor ${original.cohort.status}/${original.cohort.model}/${original.cohort.attempts} row`,
          should:
            'preserve identity, report and exact observed facts without inferring any claimed outcome',
          actual: [
            row.round_id,
            row.freeze_revision,
            new Date(history.createdAt).toISOString(),
            history.completedAt && new Date(history.completedAt).toISOString(),
            history.claimedAttempts,
            history.model,
            history.inputTokens,
            history.outputTokens,
            state.kind,
            'report' in state ? state.report : null,
            'requestId' in state,
            'calls' in state,
            'lease' in state,
          ],
          expected: [
            original.roundId,
            1,
            originalTime.toISOString(),
            original.cohort.status === 'leased'
              ? null
              : completion.toISOString(),
            original.cohort.attempts,
            original.cohort.model,
            original.cohort.input,
            original.cohort.output,
            original.cohort.status === 'leased'
              ? 'unrequested'
              : original.cohort.status === 'succeeded'
                ? 'retained'
                : 'retired',
            original.cohort.status === 'succeeded' ? report : null,
            false,
            false,
            false,
          ],
        });
      }
      await scratch.migrate(() => true);
      assert({
        given: 'a migration replay',
        should: 'leave all observed facts and identities unchanged',
        actual: await snapshot(),
        expected: migrated,
      });
      const [usage] =
        await f.sql`select count(*)::integer as n from usage_reservations where kind='round_analysis'`;
      const store = createDatabase({ url: scratch.url, ...storeOptions });
      try {
        assert({
          given: 'all migrated automatic rows',
          should: 'create no allowance records or discoverable request',
          actual: [usage.n, await store.scanRoundAnalysisJobs(64)],
          expected: [0, []],
        });
        const original = originals[1]!;
        const [actor] =
          await f.sql`select user_id from actors where id=${original.actorId}`;
        const request = (target = original) =>
          store.requestRoundAnalysis({
            roundId: target.roundId,
            caller: {
              userId: String(actor.user_id),
              actorId: original.actorId,
            },
            authorize: (access) => canUseAiAllowance(access.account),
          });
        assert({
          given: 'an old token against retired automatic authority',
          should: 'permit no dispatch',
          actual: await store.beginRoundAnalysisModelCall(
            original,
            createId(),
            oldDigest,
          ),
          expected: null,
        });
        await assertRejects({
          given: 'an old result trying to publish without a user request',
          should: 'refuse',
          code: 'CONFLICT',
          actual: () =>
            store.completeRoundAnalysisJob(
              original,
              createId(),
              oldDigest,
              report,
            ),
        });
        const requested = await request();
        const claim = await store.claimRoundAnalysisJob(original);
        if (!claim) throw Error('Expected remaining historical call');
        await store.beginRoundAnalysisModelCall(
          original,
          claim.callId,
          claim.token,
        );
        await store.retryRoundAnalysisJob(original, claim.callId, claim.token);
        const [updated] =
          await f.sql`select work from round_analyses where round_participant_id=${original.roundParticipantId}`;
        const [counted] =
          await f.sql`select state from usage_reservations where round_id=${original.roundId} and kind='round_analysis'`;
        assert({
          given:
            'one old possible claim plus one new requested dispatch whose outcome is unknown',
          should:
            'exhaust the original seat budget and retain unknown new usage despite positive historical tokens',
          actual: [
            requested.historical,
            updated.work.kind,
            updated.work.reason,
            updated.work.calls.length,
            counted.state.kind,
            await store.claimRoundAnalysisJob(original),
            (await request()).kind,
          ],
          expected: [
            migrated.find(
              (r) => r.round_participant_id === original.roundParticipantId,
            )!.work.historical,
            'failed',
            'exhausted',
            1,
            'unknown',
            null,
            'failed',
          ],
        });
        await f.sql`delete from utterances where round_id=${original.roundId}`;
        assert({
          given:
            'actual transcript-line expiry after migration and terminal work',
          should: 'retain the same seat identity instead of cascading it away',
          actual: (
            await f.sql`select count(*)::integer as n from round_analyses where round_participant_id=${original.roundParticipantId}`
          )[0].n,
          expected: 1,
        });
      } finally {
        await store.close();
      }
    });
  },
  ddlTimeoutMs,
);
