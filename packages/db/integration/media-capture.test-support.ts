import { createId } from '@paralleldrive/cuid2';
import type { BoundedTransaction } from '../src/bounded-transaction';
import { mediaCaptureOperations } from '../src/media-capture';
import type { Fixture } from './constraint-helpers';

export async function historicalCapture(
  fixture: Fixture,
  transaction: BoundedTransaction,
  roundId: string,
  endedAgoMs = 1000,
) {
  const [clock] = await fixture.sql`select clock_timestamp() as now`;
  const end = new Date(clock!.now.getTime() - endedAgoMs);
  const start = new Date(end.getTime() - 1000);
  await fixture.sql.unsafe(
    "update rounds set status='completed',outcome='affirmative',started_at=$2,completed_at=$3,final_segment_ended_at=$3,transcript_admission_cutoff=$4 where id=$1",
    [roundId, start, end, new Date(end.getTime() + 120000)],
  );
  const seat = await fixture.seat(roundId, 'affirmative');
  const segmentId = createId();
  const sessionId = createId();
  const workerId = createId();
  await fixture.insert('round_segments', {
    id: segmentId,
    round_id: roundId,
    sequence: 0,
    type: 'speech',
    rules_segment_key: 'AC',
    started_at: start,
    ended_at: end,
    duration_ms: 1000,
  });
  await fixture.sql.unsafe(
    'insert into round_speaking_intervals(id,round_id,segment_id,round_participant_id,started_at,ended_at,started_version,ended_version) values($1,$2,$3,$4,$5,$6,1,2)',
    [createId(), roundId, segmentId, seat.id, start, end],
  );
  await fixture.insert('media_sessions', {
    id: sessionId,
    round_id: roundId,
    room_name: createId(),
  });
  const store = mediaCaptureOperations({
    transaction,
    nextId: createId,
    buildProjection: () => {
      throw new Error(
        'Terminal historical capture cannot invent a runtime projection',
      );
    },
  });
  const lease = { roundId, sessionId, workerId };
  const stream = { ...lease, epoch: 1, segmentId, roundParticipantId: seat.id };
  const clip = {
    ...stream,
    trackId: createId(),
    startOffsetMs: 100,
    durationMs: 100,
    text: 'Synthetic captured words',
    before: new Date(start.getTime() + 99).toISOString(),
    after: new Date(start.getTime() + 201).toISOString(),
  };
  return { store, lease, stream, clip, start, end };
}
