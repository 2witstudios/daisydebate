import { ballotCategories, ballotSchema } from '@daisy/protocol';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rejectedBy, withFixture } from './constraint-helpers';
import { queueSchemaJudge } from './capture-schema.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('a judging intent acquires one actual command identifier and preserves it across attempts', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const judges = [
      await fixture.seat(roundId, 'judge'),
      await fixture.seat(roundId, 'judge', 1),
    ];
    const commandId = createId();
    try {
      await fixture.sql.unsafe(
        "insert into round_transcript_freezes(round_id,revision,frontier,completeness) values($1,1,0,'incomplete')",
        [roundId],
      );
      for (const judge of judges)
        await queueSchemaJudge(fixture, roundId, judge.id);
      await fixture.sql.unsafe(
        'update round_judging_jobs set command_id=$1 where round_id=$2 and judge_participant_id=$3',
        [commandId, roundId, judges[0]!.id],
      );
      const update = (value: string | null, seat = judges[0]!.id) =>
        fixture.sql.unsafe(
          'update round_judging_jobs set command_id=$1 where round_id=$2 and judge_participant_id=$3',
          [value, roundId, seat],
        );
      assert({
        given: 'a command allocated once for the first claim',
        should: 'refuse replacement, clearing or sharing it with another job',
        actual: await Promise.all([
          rejectedBy(() => update(createId())),
          rejectedBy(() => update(null)),
          rejectedBy(() => update(commandId, judges[1]!.id)),
        ]),
        expected: [
          'round_judging_jobs_command_immutable',
          'round_judging_jobs_command_immutable',
          'round_judging_jobs_command_unique',
        ],
      });
      await fixture.sql.unsafe(
        'update round_judging_jobs set attempts=attempts+1 where round_id=$1 and judge_participant_id=$2',
        [roundId, judges[0]!.id],
      );
      assert({
        given: 'a subsequent attempt on the same durable intent',
        should: 'retain its exact command identifier',
        actual: (
          await fixture.sql.unsafe(
            'select command_id,attempts from round_judging_jobs where round_id=$1 and judge_participant_id=$2',
            [roundId, judges[0]!.id],
          )
        )[0],
        expected: { command_id: commandId, attempts: 1 },
      });
      assert({
        given: 'a job attempting to move to another freeze revision',
        should: 'refuse identity mutation',
        actual: await rejectedBy(() =>
          fixture.sql.unsafe(
            'update round_judging_jobs set freeze_revision=2 where round_id=$1 and judge_participant_id=$2',
            [roundId, judges[0]!.id],
          ),
        ),
        expected: 'round_judging_jobs_identity_immutable',
      });
    } finally {
      await fixture.sql.unsafe(
        'delete from round_judging_jobs where round_id=$1',
        [roundId],
      );
      await fixture.sql.unsafe(
        'delete from round_transcript_freezes where round_id=$1',
        [roundId],
      );
    }
  });
});

test('pending judging response survives takeover with immutable origin until atomic ballot success', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const judge = await fixture.seat(roundId, 'judge');
    const otherJudge = await fixture.seat(roundId, 'judge', 1);
    const runId = createId(),
      otherRunId = createId();
    try {
      await fixture.sql.unsafe(
        "insert into round_transcript_freezes(round_id,revision,frontier,completeness) values($1,1,0,'incomplete')",
        [roundId],
      );
      await queueSchemaJudge(fixture, roundId, judge.id);
      for (const [id, seat] of [
        [runId, judge.id],
        [otherRunId, otherJudge.id],
      ])
        await fixture.insert('agent_runs', {
          id,
          round_participant_id: seat,
          kind: 'judging',
          provider: 'synthetic-schema-fixture',
          started_at: new Date(1000),
        });
      const pending = ballotSchema.parse({
        rubricVersion: 'speaker-10@1',
        winner: 'affirmative',
        scores: Object.fromEntries(
          ['affirmative', 'negative'].map((side) => [
            side,
            Object.fromEntries(
              ballotCategories.map((category) => [category, 3]),
            ),
          ]),
        ),
        reason: 'Synthetic recovery fixture',
        feedback: {},
      });
      assert({
        given: 'an incomplete cache tuple, future epoch or another judge run',
        should: 'refuse every invalid pending response scope',
        actual: await Promise.all([
          rejectedBy(() =>
            fixture.sql.unsafe(
              'update round_judging_jobs set pending_ballot=$1 where round_id=$2 and judge_participant_id=$3',
              [pending, roundId, judge.id],
            ),
          ),
          rejectedBy(() =>
            fixture.sql.unsafe(
              'update round_judging_jobs set attempts=1,pending_ballot=$1,pending_ballot_agent_run_id=$2,pending_ballot_epoch=2,pending_ballot_received_at=clock_timestamp() where round_id=$3 and judge_participant_id=$4',
              [pending, runId, roundId, judge.id],
            ),
          ),
          rejectedBy(() =>
            fixture.sql.begin(async (tx) => {
              await tx.unsafe(
                'update round_judging_jobs set attempts=1,pending_ballot=$1,pending_ballot_agent_run_id=$2,pending_ballot_epoch=1,pending_ballot_received_at=clock_timestamp() where round_id=$3 and judge_participant_id=$4',
                [pending, otherRunId, roundId, judge.id],
              );
            }),
          ),
        ]),
        expected: [
          'round_judging_jobs_pending_check',
          'round_judging_jobs_pending_check',
          'round_judging_jobs_pending_run_judge_fk',
        ],
      });
      await fixture.sql.unsafe(
        'update round_judging_jobs set attempts=1,pending_ballot=$1,pending_ballot_agent_run_id=$2,pending_ballot_epoch=1,pending_ballot_received_at=clock_timestamp() where round_id=$3 and judge_participant_id=$4',
        [pending, runId, roundId, judge.id],
      );
      assert({
        given: 'a durable validated response awaiting attendance settlement',
        should:
          'refuse direct deletion and freeze-cascade deletion while Round survives',
        actual: await Promise.all([
          rejectedBy(() =>
            fixture.sql.unsafe(
              'delete from round_judging_jobs where round_id=$1 and judge_participant_id=$2',
              [roundId, judge.id],
            ),
          ),
          rejectedBy(() =>
            fixture.sql.unsafe(
              'delete from round_transcript_freezes where round_id=$1',
              [roundId],
            ),
          ),
        ]),
        expected: [
          'round_judging_jobs_pending_delete',
          'round_judging_jobs_pending_delete',
        ],
      });
      assert({
        given: 'the exact origin run of a pending response',
        should:
          'refuse direct deletion at deferred commit and preserve recovery after rollback',
        actual: await rejectedBy(() =>
          fixture.sql.begin(async (tx) => {
            await tx.unsafe('delete from agent_runs where id=$1', [runId]);
          }),
        ),
        expected: 'round_judging_jobs_pending_run_judge_fk',
      });

      await fixture.sql.unsafe(
        'update round_judging_jobs set attempts=2 where round_id=$1 and judge_participant_id=$2',
        [roundId, judge.id],
      );
      const [cached] = await fixture.sql.unsafe(
        'select pending_ballot,pending_ballot_agent_run_id,pending_ballot_epoch from round_judging_jobs where round_id=$1 and judge_participant_id=$2',
        [roundId, judge.id],
      );
      assert({
        given: 'a new takeover attempt',
        should: 'retain the response and original run epoch',
        actual: cached,
        expected: {
          pending_ballot: pending,
          pending_ballot_agent_run_id: runId,
          pending_ballot_epoch: 1,
        },
      });
      assert({
        given: 'a cached response before shared ballot success',
        should: 'refuse replacement or clearing',
        actual: await Promise.all([
          rejectedBy(() =>
            fixture.sql.unsafe(
              'update round_judging_jobs set pending_ballot_agent_run_id=$1 where round_id=$2 and judge_participant_id=$3',
              [otherRunId, roundId, judge.id],
            ),
          ),
          rejectedBy(() =>
            fixture.sql.unsafe(
              'update round_judging_jobs set pending_ballot=null,pending_ballot_agent_run_id=null,pending_ballot_epoch=null,pending_ballot_received_at=null where round_id=$1 and judge_participant_id=$2',
              [roundId, judge.id],
            ),
          ),
        ]),
        expected: [
          'round_judging_jobs_pending_immutable',
          'round_judging_jobs_pending_immutable',
        ],
      });
      const ballotId = createId();
      await fixture.insert('ballots', {
        id: ballotId,
        judge_participant_id: judge.id,
        round_id: roundId,
        freeze_revision: 1,
        rubric_version: 'speaker-10@1',
        winner: 'affirmative',
        scores: {},
        reason: 'Synthetic result',
        status: 'submitted',
        submitted_at: new Date(2000),
      });
      await fixture.sql.unsafe(
        "update round_judging_jobs set status='succeeded',result_ballot_id=$1,pending_ballot=null,pending_ballot_agent_run_id=null,pending_ballot_epoch=null,pending_ballot_received_at=null where round_id=$2 and judge_participant_id=$3",
        [ballotId, roundId, judge.id],
      );
      assert({
        given: 'the actual committed shared ballot receipt',
        should: 'permit clearing the cache with success',
        actual: (
          await fixture.sql.unsafe(
            'select pending_ballot from round_judging_jobs where round_id=$1 and judge_participant_id=$2',
            [roundId, judge.id],
          )
        )[0],
        expected: { pending_ballot: null },
      });
      await queueSchemaJudge(fixture, roundId, otherJudge.id);
      await fixture.sql.unsafe(
        'update round_judging_jobs set attempts=1,pending_ballot=$1,pending_ballot_agent_run_id=$2,pending_ballot_epoch=1,pending_ballot_received_at=clock_timestamp() where round_id=$3 and judge_participant_id=$4',
        [pending, otherRunId, roundId, otherJudge.id],
      );
      await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
      assert({
        given: 'owning Round erasure',
        should: 'remove jobs and response provenance',
        actual: await fixture.count('round_judging_jobs', 'round_id', roundId),
        expected: 0,
      });
    } finally {
      await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
    }
  });
});
