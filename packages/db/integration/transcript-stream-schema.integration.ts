import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rejectedBy, withFixture } from './constraint-helpers';
import {
  captureSchemaStream,
  capturedSchemaUtterance,
} from './capture-schema.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('an expected missing stream can close partial and its closure cannot be rewritten complete', async () => {
  await withFixture(url, async (fixture) => {
    const { roundId, seat, segmentId } = await captureSchemaStream(
      fixture,
      false,
    );
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

test('owning Round erasure removes captured text while direct seat deletion stays fenced', async () => {
  await withFixture(url, async (fixture) => {
    const { roundId, seat, segmentId } = await captureSchemaStream(fixture);
    await capturedSchemaUtterance(fixture, {
      roundId,
      segmentId,
      seatId: seat.id,
    });
    assert({
      given: 'captured text still referencing a durable Round seat',
      should: 'refuse direct seat deletion',
      actual: await rejectedBy(() =>
        fixture.sql.unsafe('delete from round_participants where id=$1', [
          seat.id,
        ]),
      ),
      expected: 'utterances_participant_round_fk',
    });
    assert({
      given: 'an owning Round erased with captured private transcript text',
      should: 'cascade its children before checking scoped seat consistency',
      actual: await rejectedBy(() =>
        fixture.sql.unsafe('delete from rounds where id=$1', [roundId]),
      ),
      expected: null,
    });
  });
});
