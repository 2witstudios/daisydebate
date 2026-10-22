import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rejectedBy, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('one immutable transcript revision fences the durable judging intent', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const judge = await fixture.seat(roundId, 'judge');
    const freeze = () =>
      fixture.sql.unsafe(
        "insert into round_transcript_freezes (round_id, revision, frontier, completeness) values ($1, 1, 7, 'incomplete')",
        [roundId],
      );
    try {
      await freeze();
      const duplicate = await rejectedBy(freeze);
      const immutable = await rejectedBy(() =>
        fixture.sql.unsafe(
          "update round_transcript_freezes set frontier = 8, completeness = 'complete' where round_id = $1",
          [roundId],
        ),
      );
      const wrongRevision = await rejectedBy(() =>
        fixture.sql.unsafe(
          "insert into round_judging_jobs (round_id, freeze_revision, judge_participant_id, status, attempts) values ($1,2,$2,'queued',0)",
          [roundId, judge.id],
        ),
      );
      await fixture.sql.unsafe(
        "insert into round_judging_jobs (round_id, freeze_revision, judge_participant_id, status, attempts) values ($1,1,$2,'queued',0)",
        [roundId, judge.id],
      );
      assert({
        given: 'an incomplete frozen revision and queued judging intent',
        should:
          'reject duplicate freeze, mutation and judging a different revision',
        actual: { duplicate, immutable, wrongRevision },
        expected: {
          duplicate: 'round_transcript_freezes_pkey',
          immutable: 'round_transcript_freezes_immutable',
          wrongRevision: 'round_judging_jobs_freeze_revision_fk',
        },
      });
      const [freezeRow] = await fixture.sql.unsafe(
        'select frontier, completeness from round_transcript_freezes where round_id=$1',
        [roundId],
      );
      assert({
        given: 'a rejected late rewrite',
        should: 'preserve the exact incomplete transcript frontier',
        actual: freezeRow,
        expected: { frontier: 7, completeness: 'incomplete' },
      });
    } finally {
      const [table] =
        await fixture.sql`select to_regclass('public.round_transcript_freezes') as name`;
      if (table?.name) {
        await fixture.sql.unsafe(
          'delete from round_judging_jobs where round_id=$1',
          [roundId],
        );
        await fixture.sql.unsafe(
          'delete from round_transcript_freezes where round_id=$1',
          [roundId],
        );
      }
    }
  });
});
