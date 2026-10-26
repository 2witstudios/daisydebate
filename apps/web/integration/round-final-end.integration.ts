import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('internal shared tick persists actual final end and immutable admission cutoff without a browser command', async () => {
  await withRoomRuntime(async (f) => {
    const { roundId, operations } = await startRuntimeRound(
      f,
      await f.assemble(),
    );
    await f.sql`update rounds set started_at=clock_timestamp()-interval '20 minutes' where id=${roundId}`;
    const receipt = await operations.tick(roundId);
    const [row] =
      await f.sql`select status,final_segment_ended_at,transcript_admission_cutoff from rounds where id=${roundId}`;
    const [segment] =
      await f.sql`select ended_at from round_segments where round_id=${roundId} order by sequence desc limit 1`;
    assert({
      given: 'no participant command after start and a due internal clock tick',
      should:
        'close actual final segment and fix a120000ms cutoff while judging',
      actual: {
        status: row.status,
        exact:
          row.final_segment_ended_at.getTime() === segment.ended_at.getTime(),
        buffer:
          row.transcript_admission_cutoff.getTime() -
          row.final_segment_ended_at.getTime(),
        version: receipt.resultingVersion,
      },
      expected: { status: 'active', exact: true, buffer: 120000, version: 3 },
    });
    const repeated = await operations.tick(roundId);
    assert({
      given: 'the reconciler repeats after the final deadline',
      should:
        'replay current durable clock state without a new version or deadline',
      actual: {
        version: repeated.resultingVersion,
        rows: (
          await f.sql`select id from round_segments where round_id=${roundId}`
        ).length,
        cutoff: (
          await f.sql`select transcript_admission_cutoff from rounds where id=${roundId}`
        )[0].transcript_admission_cutoff.getTime(),
      },
      expected: {
        version: 3,
        rows: 2,
        cutoff: row.transcript_admission_cutoff.getTime(),
      },
    });
  });
});
