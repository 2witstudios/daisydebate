import type { SQL } from 'bun';
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
    await f.sql`insert into round_attendance_adjudications(evidence,round_id,segment_id,command_id,decision,effective_deadline,settled_horizon) values('settled_availability',${roundId},${segment.id},${commandId},'attended',${deadline},${horizon})`;
  }
}

/**
 * Plays a Round to its end, long enough ago that its attendance cutoff has
 * passed: every rule segment holds a closed row, a second each, the last ending
 * at the Round's final end, so the cutoff is the true one. Timestamps are
 * write-once, so this runs with the guards off; the CHECKs still hold.
 */
export const passAttendanceCutoff = (
  sql: SQL,
  roundId: string,
  agoSeconds = 1,
) =>
  sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`insert into round_segments(id,round_id,sequence,type,rules_segment_key,started_at,ended_at,duration_ms)
      select ${createId()}||rule.at::text,${roundId},(rule.at-1)::int,rule.segment->>'type',rule.segment->>'key',
        ended.at-(rule.total-rule.at+1)*interval '1 second',
        ended.at-(rule.total-rule.at)*interval '1 second',
        (rule.segment->>'durationMs')::int
      from (select date_trunc('milliseconds',clock_timestamp())-interval '60 minutes'-${agoSeconds}*interval '1 second' as at) ended,
        (select segment,at,count(*) over () as total
          from rounds r, jsonb_array_elements(r.rules_snapshot->'segments') with ordinality as s(segment,at)
          where r.id=${roundId}) rule
      on conflict (round_id,sequence) do update set started_at=excluded.started_at,ended_at=excluded.ended_at`;
    await tx`update round_speaking_intervals i set started_at=s.started_at,ended_at=s.ended_at,
        ended_version=coalesce(i.ended_version,i.started_version)
      from round_segments s where s.id=i.segment_id and i.round_id=${roundId}`;
    // Every speech has closed, so a Round still active awaits its ballot: the stage the clock derives.
    await tx`update rounds r set
      current_stage=case when r.status='active' then 'awaiting_ballot' end,
      started_at=least(r.started_at,first.at),
      final_segment_ended_at=last.at,
      transcript_admission_cutoff=last.at+interval '120 seconds',
      attendance_resolution_cutoff_at=last.at+interval '60 minutes'
      from (select min(started_at) as at from round_segments where round_id=${roundId}) first,
        (select max(ended_at) as at from round_segments where round_id=${roundId}) last
      where r.id=${roundId}`;
  });
