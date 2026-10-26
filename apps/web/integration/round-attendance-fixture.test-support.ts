import { attendanceTimingPolicy } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import type { withRoomRuntime } from './room-runtime.test-support';

/** D1 storage-component fixture only; public sampler/check-in/evaluator journey is separately required. */
export async function seedSettledAttendanceLedger(
  f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
  roundId: string,
) {
  const round = (await f.store.getRound(roundId))!;
  const lastSpeech = round.rules.segments
    .filter((s) => s.type === 'speech')
    .at(-1)!.key;
  for (const segment of round.segments.filter(
    (s) => s.type === 'speech' && s.rulesSegmentKey !== lastSpeech,
  )) {
    const commandId = createId();
    const deadline = new Date(
      Date.parse(segment.startedAt) + attendanceTimingPolicy.graceMs,
    );
    const horizon = new Date(
      deadline.getTime() + attendanceTimingPolicy.finalizationBufferMs,
    );
    await f.sql`insert into round_commands(command_id,round_id,service_id,type,payload_digest,result,resulting_version,applied_at) values(${commandId},${roundId},${`round-attendance:${createId()}`},'adjudicate',${'a'.repeat(64)},${{ segmentId: segment.id, decision: 'attended', effectiveDeadline: deadline.toISOString(), settledHorizon: horizon.toISOString() }},${round.version},clock_timestamp())`;
    await f.sql`insert into round_attendance_adjudications(round_id,segment_id,command_id,decision,effective_deadline,settled_horizon) values(${roundId},${segment.id},${commandId},'attended',${deadline},${horizon})`;
  }
}
