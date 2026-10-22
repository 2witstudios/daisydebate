import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rejectedBy, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('an expected missing stream can close partial and its closure cannot be rewritten complete', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const seat = await fixture.seat(roundId, 'affirmative');
    const segmentId = createId();
    await fixture.insert('round_segments', {
      id: segmentId,
      round_id: roundId,
      sequence: 0,
      type: 'speech',
      rules_segment_key: 'AC',
      started_at: new Date(1000),
      duration_ms: 1000,
    });
    try {
      await fixture.sql.unsafe(
        "insert into transcript_segments (round_id, segment_id, round_participant_id, state, chunk_count, sealed_chunk_count, sealed_at) values ($1,$2,$3,'partial',0,0,clock_timestamp())",
        [roundId, segmentId, seat.id],
      );
      assert({
        given: 'an expected stream closed partial without any observed chunks',
        should: 'refuse a later completeness rewrite',
        actual: await rejectedBy(() =>
          fixture.sql.unsafe(
            "update transcript_segments set state='complete' where segment_id=$1 and round_participant_id=$2",
            [segmentId, seat.id],
          ),
        ),
        expected: 'transcript_segments_seal_immutable',
      });
    } finally {
      const [table] =
        await fixture.sql`select to_regclass('public.transcript_segments') as name`;
      if (table?.name)
        await fixture.sql.unsafe(
          'delete from transcript_segments where round_id=$1',
          [roundId],
        );
    }
  });
});
