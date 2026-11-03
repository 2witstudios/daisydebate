import { afterAll } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { captureSchemaStream } from './capture-schema.test-support';
import { rejectedBy, withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const migration = '20261102234251_capture_partial_reasons';
const scratch = scratchDatabase(url, 'partialreasonsit');

afterAll(() => scratch.drop());

test(
  'a stream sealed partial before reasons existed gains one, and its seal stays immutable',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    await withFixture(scratch.url, async (f) => {
      const stream = await captureSchemaStream(f);
      await f.sql`insert into transcript_segments(round_id,segment_id,round_participant_id,state,chunk_count,sealed_chunk_count,sealed_at)
        values(${stream.roundId},${stream.segmentId},${stream.seat.id},'partial',0,0,clock_timestamp())`;
      await scratch.migrate((folder) => folder <= migration);
      const [row] = await f.sql`select partial_reasons from transcript_segments
        where segment_id=${stream.segmentId} and round_participant_id=${stream.seat.id}`;
      assert({
        given: 'a database holding a partial stream with no reason',
        should: 'migrate, giving that stream a reason',
        actual: row.partial_reasons,
        expected: ['never-sealed'],
      });
      assert({
        given: 'that stream after the backfill',
        should: 'refuse any change: the seal guard is back on',
        actual: await rejectedBy(
          () =>
            f.sql`update transcript_segments set partial_reasons='{frames-lost}'
              where segment_id=${stream.segmentId} and round_participant_id=${stream.seat.id}`,
        ),
        expected: 'transcript_segments_seal_immutable',
      });
      const other = await captureSchemaStream(f);
      const insert = (reasons: string) =>
        f.sql`insert into transcript_segments(round_id,segment_id,round_participant_id,state,partial_reasons,chunk_count,sealed_chunk_count,sealed_at)
          values(${other.roundId},${other.segmentId},${other.seat.id},'partial',${reasons},0,0,clock_timestamp())`;
      assert({
        given:
          'a partial stream with no reason, and one with an unknown reason',
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
  },
  { timeout: ddlTimeoutMs * 2 },
);
