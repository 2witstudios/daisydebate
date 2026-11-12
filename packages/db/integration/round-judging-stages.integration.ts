import { isDeepStrictEqual } from 'node:util';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { syntheticCaseMap } from '../src/testing-judging';
import {
  syntheticPendingBallot as ballot,
  withJudgingJob,
} from './round-judging.test-support';
setupRitewayBun();
requireTestServices(process.env);

const usage = { inputTokens: 10, outputTokens: 5 };
const rejected = {
  category: 'schema_rejected' as const,
  finish: 'stop' as const,
  issueCount: 1,
  issues: [{ field: 'reason' as const, code: 'too_big' as const, limit: 600 }],
};

type Value = Parameters<Parameters<typeof withJudgingJob>[0]>[0];
const jobRow = async ({
  fixture,
  roundId,
}: Pick<Value, 'fixture' | 'roundId'>) => {
  const [job] =
    await fixture.sql`select status,lease_expires_at is null as released,
      retry_at<=clock_timestamp() as due,first_ballot is not null as first,first_ballot_failed as first_failed,
      case_map is not null as map,pending_ballot is not null as held
    from round_judging_jobs where round_id=${roundId}`;
  return { ...job };
};
const attemptRows = async ({
  fixture,
  roundId,
}: Pick<Value, 'fixture' | 'roundId'>) =>
  (
    (await fixture.sql`select stage,outcome,category from round_judging_attempts
      where round_id=${roundId} order by job_epoch`) as {
      stage: string;
      outcome: string;
      category: string | null;
    }[]
  ).map((row) => ({ ...row }));

test('coherency judging buys each stage once, in order, and keeps the stage records (ADR 0125)', () =>
  withJudgingJob(
    async (value) => {
      const { jobs, target } = value;
      const first = await jobs.claim(target);
      const due = (await jobs.verify(first.scope, first.token)).stage;
      await assertRejects({
        given: 'a new job',
        should: 'refuse to buy any stage but the first pass',
        actual: () => jobs.beginModelCall(first.scope, first.token, 'final'),
        code: 'CONFLICT',
      });
      await jobs.beginModelCall(first.scope, first.token, 'first');
      await jobs.saveStage(
        first.scope,
        first.token,
        { stage: 'first', ballot },
        usage,
      );
      const afterFirst = await jobRow(value);

      const map = await jobs.claim(target);
      const mapDue = (await jobs.verify(map.scope, map.token)).stage;
      await jobs.beginModelCall(map.scope, map.token, 'map');
      await jobs.saveStage(
        map.scope,
        map.token,
        { stage: 'map', caseMap: syntheticCaseMap },
        usage,
      );

      const final = await jobs.claim(target);
      const verified = await jobs.verify(final.scope, final.token);
      await assertRejects({
        given: 'a job whose case map is stored',
        should: 'never buy the case map again after a takeover',
        actual: () => jobs.beginModelCall(final.scope, final.token, 'map'),
        code: 'CONFLICT',
      });
      await jobs.beginModelCall(final.scope, final.token, 'final');
      await jobs.saveResult(final.scope, final.token, ballot, usage);

      assert({
        given: 'a new job claimed for each stage in turn',
        should:
          'buy the first pass, the case map and the final ballot, release the job due at once after each earlier stage, and keep every stage record',
        actual: {
          due: [due, mapDue, verified.stage],
          mapForFinal: isDeepStrictEqual(verified.caseMap, syntheticCaseMap),
          afterFirst,
          end: await jobRow(value),
          attempts: await attemptRows(value),
        },
        expected: {
          due: ['first', 'map', 'final'],
          mapForFinal: true,
          afterFirst: {
            status: 'queued',
            released: true,
            due: true,
            first: true,
            first_failed: false,
            map: false,
            held: false,
          },
          end: {
            status: 'leased',
            released: false,
            due: null,
            first: true,
            first_failed: false,
            map: true,
            held: true,
          },
          attempts: [
            { stage: 'first', outcome: 'succeeded', category: null },
            { stage: 'map', outcome: 'succeeded', category: null },
            { stage: 'final', outcome: 'succeeded', category: null },
          ],
        },
      });
    },
    'complete',
    undefined,
    'first',
  ));

test('a failed first pass is recorded once and the job moves on to the case map', () =>
  withJudgingJob(
    async (value) => {
      const { jobs, target, fixture, roundId } = value;
      const first = await jobs.claim(target);
      await jobs.beginModelCall(first.scope, first.token, 'first');
      await jobs.recordUsage(first.scope, first.token, usage);
      const deferred = await jobs.recordAttemptFailure(
        first.scope,
        first.token,
        {
          diagnostic: rejected,
          final: false,
        },
      );
      await fixture.sql`update round_judging_jobs set retry_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
      const next = await jobs.claim(target);
      assert({
        given: 'a first-pass answer that failed validation',
        should:
          'record the failure on its attempt, mark the first pass tried, and make the case map due next',
        actual: {
          deferred,
          stage: (await jobs.verify(next.scope, next.token)).stage,
          job: await jobRow(value),
          attempts: await attemptRows(value),
        },
        expected: {
          deferred: { kind: 'retry' },
          stage: 'map',
          job: {
            status: 'leased',
            released: false,
            due: null,
            first: false,
            first_failed: true,
            map: false,
            held: false,
          },
          attempts: [
            { stage: 'first', outcome: 'failed', category: 'schema_rejected' },
          ],
        },
      });
    },
    'complete',
    undefined,
    'first',
  ));

test('a stage record is accepted only from its own stage’s call', () =>
  withJudgingJob(
    async ({ jobs, target }) => {
      const claim = await jobs.claim(target);
      await jobs.beginModelCall(claim.scope, claim.token, 'first');
      await assertRejects({
        given: 'a first-pass call answered with a case map',
        should: 'refuse to store it',
        actual: () =>
          jobs.saveStage(
            claim.scope,
            claim.token,
            { stage: 'map', caseMap: syntheticCaseMap },
            usage,
          ),
        code: 'CONFLICT',
      });
      await assertRejects({
        given: 'a first-pass record that is not a ballot',
        should: 'refuse it before any write',
        actual: () =>
          jobs.saveStage(
            claim.scope,
            claim.token,
            { stage: 'first', ballot: { winner: 'affirmative' } },
            usage,
          ),
        code: 'VALIDATION',
      });
    },
    'complete',
    undefined,
    'first',
  ));
