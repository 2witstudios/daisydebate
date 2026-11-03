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
        "insert into transcript_segments (round_id, segment_id, round_participant_id, state, partial_reasons, chunk_count, sealed_chunk_count, sealed_at) values ($1,$2,$3,'partial','{never-sealed}',0,0,clock_timestamp())",
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

test('captured transcript storage exposes no retired generation-claim columns or check', async () => {
  await withFixture(url, async (fixture) => {
    const [catalog] =
      await fixture.sql`select (select count(*)::int from pg_attribute where attrelid='utterances'::regclass and attname in ('generation_token','generation_expires_at') and not attisdropped) columns,(select count(*)::int from pg_constraint where conrelid='utterances'::regclass and conname='utterances_generation_pair') checks`;
    assert({
      given:
        'the total cutover to captured transcript ingress and scoped bot generation',
      should: 'remove the abandoned bearer-claim storage surface',
      actual: catalog,
      expected: { columns: 0, checks: 0 },
    });
  });
});

test('a partial stream names a known reason', async () => {
  await withFixture(url, async (fixture) => {
    const { roundId, seat, segmentId } = await captureSchemaStream(fixture);
    const insert = (reasons: string) =>
      fixture.sql`insert into transcript_segments(round_id,segment_id,round_participant_id,state,partial_reasons,chunk_count,sealed_chunk_count,sealed_at)
        values(${roundId},${segmentId},${seat.id},'partial',${reasons},0,0,clock_timestamp())`;
    assert({
      given: 'a partial stream with no reason, and one with an unknown reason',
      should: 'refuse both',
      actual: [
        await rejectedBy(() => insert('{}')),
        await rejectedBy(() => insert('{because}')),
      ],
      expected: [
        'transcript_segments_partial_reasons_check',
        'transcript_segments_partial_reasons_known_check',
      ],
    });
  });
});
