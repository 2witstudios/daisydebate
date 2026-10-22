import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundFinalizationOperations } from '../src/features/round-finalization/operations';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('silent human-only Round with no media session finalizes missing streams honestly after its actual cutoff', async () => {
  await withRoomRuntime(async (f) => {
    const { roundId } = await startRuntimeRound(f, await f.assemble());
    await f.sql`update rounds set started_at=clock_timestamp()-interval '20 minutes' where id=${roundId}`;
    const operation = createRoundFinalizationOperations({
      store: f.store,
      nextSegmentId: createId,
    });
    const result = await operation.finalize(roundId);
    const freeze =
      await f.sql`select revision,frontier,completeness from round_transcript_freezes where round_id=${roundId}`;
    const streams =
      await f.sql`select state,chunk_count,sealed_chunk_count from transcript_segments where round_id=${roundId} order by segment_id,round_participant_id`;
    const frozenInput = await f.store.readFrozenRoundTranscript(roundId);
    const repeated = await operation.finalize(roundId);
    const jobs =
      await f.sql`select round_id from round_judging_jobs where round_id=${roundId}`;
    assert({
      given:
        'a silent scheduler and a human-only Round with no capture session/streams',
      should:
        'advance the real engine, freeze zero committed text incomplete and close each missing actual speech stream partial without a bot job',
      actual: {
        status: result.status,
        freeze: [...freeze],
        streams: [...streams],
        jobs: jobs.length,
        frozenInput: frozenInput && {
          revision: frozenInput.revision,
          frontier: frozenInput.frontier,
          completeness: frozenInput.completeness,
          coverage: frozenInput.coverage.map((stream) => stream.state),
          utterances: frozenInput.utterances,
        },
        repeated:
          repeated.status === 'frozen' && repeated.freeze.revision === 1,
      },
      expected: {
        status: 'frozen',
        freeze: [{ revision: 1, frontier: 0, completeness: 'incomplete' }],
        streams: [
          { state: 'partial', chunk_count: 0, sealed_chunk_count: 0 },
          { state: 'partial', chunk_count: 0, sealed_chunk_count: 0 },
        ],
        jobs: 0,
        frozenInput: {
          revision: 1,
          frontier: 0,
          completeness: 'incomplete',
          coverage: ['partial', 'partial'],
          utterances: [],
        },
        repeated: true,
      },
    });
  });
});
