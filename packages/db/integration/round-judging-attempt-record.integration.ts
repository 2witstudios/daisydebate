import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { SQL } from 'bun';
import { Fixture, rejectedBy } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const record = '20261102224055_judging_attempt_is_one_record';
const scratch = scratchDatabase(databaseUrl, 'judgingattempts');
afterAll(() => scratch.drop());

test(
  'existing judging rows become one attempt record, with nothing left to refuse the deploy (ISSUE-986)',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < record);
    const client = new SQL(scratch.url);
    const f = new Fixture(client);
    try {
      const roundId = await f.round({
        status: 'active',
        current_stage: 'live',
        started_at: new Date('2026-10-31T16:00:00.000Z'),
      });
      await client`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${roundId},1,0,'complete')`;
      const judge = async (
        slot: number,
        status: string,
        outcomes: readonly string[],
      ) => {
        const id = createId();
        await f.insert('round_participants', {
          id,
          round_id: roundId,
          actor_id: await f.actor(),
          role: 'judge',
          slot,
        });
        await client`insert into round_judging_jobs(round_id,judge_participant_id,freeze_revision,status,generation_deadline_at) values(${roundId},${id},1,${status},clock_timestamp())`;
        const runs = [];
        for (const providerOutcome of outcomes) {
          const run = createId();
          await f.insert('agent_runs', {
            id: run,
            round_participant_id: id,
            kind: 'judging',
            provider: 'openrouter',
            model: 'fixture-model',
            requests: 1,
            started_at: new Date(),
            configuration_snapshot: { jobEpoch: 1, providerOutcome },
          });
          runs.push(run);
        }
        return { id, runs };
      };
      const spent = await judge(0, 'failed', ['unknown', 'received']);
      const ended = await judge(1, 'failed', ['refused']);
      await scratch.migrate((folder) => folder <= record);
      const reasons =
        await client`select judge_participant_id as id,terminal_reason as reason from round_judging_jobs where round_id=${roundId}`;
      const attempts =
        await client`select agent_run_id as run,outcome,answered_at is not null as answered from round_judging_attempts where round_id=${roundId}`;
      const reasonOf = (id: string) =>
        reasons.find((row: { id: string }) => row.id === id)?.reason;
      const attemptOf = (run: string | undefined) => {
        const row = attempts.find((a: { run: string }) => a.run === run);
        return row && [row.outcome, row.answered];
      };
      assert({
        given: 'failed jobs with no reason, with two paid calls and with none',
        should: 'name exhaustion only where the calls were bought',
        actual: [reasonOf(spent.id), reasonOf(ended.id)],
        expected: ['attempts_exhausted', 'round_ended'],
      });
      assert({
        given: 'dispatches only the run snapshot recorded',
        should:
          'keep each paid one as an attempt, answered or lost, and invent none for a refused call',
        actual: [
          attemptOf(spent.runs[0]),
          attemptOf(spent.runs[1]),
          attemptOf(ended.runs[0]),
        ],
        expected: [['dispatched', false], ['dispatched', true], undefined],
      });
      const [left] =
        await client`select count(*)::int as n from agent_runs where kind='judging' and configuration_snapshot ? 'providerOutcome'`;
      assert({
        given: 'the migrated runs',
        should: 'hold no second record of the outcome',
        actual: left.n,
        expected: 0,
      });
      assert({
        given: 'a failed job with no reason, and a queued one with a reason',
        should: 'refuse both',
        actual: [
          await rejectedBy(
            () =>
              client`update round_judging_jobs set terminal_reason=null where judge_participant_id=${spent.id}`,
          ),
          await rejectedBy(
            () =>
              client`update round_judging_jobs set status='queued' where judge_participant_id=${spent.id}`,
          ),
        ],
        expected: [
          'round_judging_jobs_terminal_reason_check',
          'round_judging_jobs_terminal_reason_check',
        ],
      });
      assert({
        given: 'a failed attempt with no category, and a dispatch with one',
        should: 'refuse both',
        actual: [
          await rejectedBy(
            () =>
              client`update round_judging_attempts set outcome='failed' where agent_run_id=${spent.runs[0]!}`,
          ),
          await rejectedBy(
            () =>
              client`update round_judging_attempts set category='timeout' where agent_run_id=${spent.runs[0]!}`,
          ),
        ],
        expected: [
          'round_judging_attempts_outcome_check',
          'round_judging_attempts_outcome_check',
        ],
      });
    } finally {
      await client.close();
    }
  },
  ddlTimeoutMs,
);
