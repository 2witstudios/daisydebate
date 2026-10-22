import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rejectedBy, withFixture } from './constraint-helpers';

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
        await fixture.sql.unsafe(
          "insert into round_judging_jobs(round_id,freeze_revision,judge_participant_id,status) values($1,1,$2,'queued')",
          [roundId, judge.id],
        );
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
