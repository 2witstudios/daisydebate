import { createId } from '@paralleldrive/cuid2';
import type { Fixture } from './constraint-helpers';

export async function captureSchemaSegment(
  fixture: Fixture,
  roundId: string,
  closed = true,
) {
  const segmentId = createId();
  await fixture.insert('round_segments', {
    id: segmentId,
    round_id: roundId,
    sequence: 0,
    type: 'speech',
    rules_segment_key: 'AC',
    started_at: new Date(1000),
    ended_at: closed ? new Date(2000) : null,
    duration_ms: 1000,
  });
  return segmentId;
}

export async function captureSchemaStream(fixture: Fixture, closed = true) {
  const roundId = await fixture.round();
  const seat = await fixture.seat(roundId, 'affirmative');
  const segmentId = await captureSchemaSegment(fixture, roundId, closed);
  return { roundId, seat, segmentId };
}

export async function capturedSchemaUtterance(
  fixture: Fixture,
  input: {
    readonly roundId: string;
    readonly segmentId: string;
    readonly seatId: string;
  },
) {
  await fixture.insert('utterances', {
    id: createId(),
    round_id: input.roundId,
    segment_id: input.segmentId,
    round_participant_id: input.seatId,
    sequence: 0,
    text: 'Synthetic capture',
    clip_key: 'a'.repeat(64),
    capture_track_id: createId(),
    capture_start_offset_ms: 0,
    capture_duration_ms: 500,
    capture_worker_epoch: 1,
    capture_body_digest: 'b'.repeat(64),
  });
}

export const queueSchemaJudge = (
  fixture: Fixture,
  roundId: string,
  judgeId: string,
) =>
  fixture.sql.unsafe(
    "insert into round_judging_jobs(round_id,freeze_revision,judge_participant_id,status) values($1,1,$2,'queued')",
    [roundId, judgeId],
  );
