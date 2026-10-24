import { idSchema } from '@daisy/protocol';
import { readLaunchDatabase } from './launch-evidence-database';
import { decodeAttendanceEvidence } from './attendance-evidence-decoder';

if (import.meta.main) {
  try {
    const roundId = idSchema.parse(Bun.argv[2]);
    const result = await readLaunchDatabase(async (tx) => {
      const [row] = await tx`select r.id as "roundId",r.status,r.version,
        to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "observedAt",
        (select count(*)::int from round_check_in_attempts where state='pending') as "pendingAttempts",
        (select count(*)::int from rating_changes where round_id=r.id) as "ratingChanges",
        (select count(*)::int from round_commands where round_id=r.id and type='check_in') as "checkInCommands",
        (select coalesce(json_agg(x order by x.at),'[]'::json) from (
          select to_char(at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at,healthy,cause
          from availability_samples order by availability_samples.at desc limit 256) x) as samples,
        (select coalesce(json_agg(x order by x."receivedAt"),'[]'::json) from (
          select state,to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "receivedAt",
          to_char(resolved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "resolvedAt"
          from round_check_in_attempts order by received_at desc limit 256) x) as "checkInAttempts",
        (select coalesce(json_agg(x order by x."instanceId"),'[]'::json) from (
          select instance_id as "instanceId",role,
          to_char(renewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "renewedAt",
          delivered_through::text as "deliveredThrough",delivered_through_txid::text as "deliveredThroughTxid"
          from service_instances) x) as instances,
        (select coalesce(json_agg(x order by x."startedAt"),'[]'::json) from (
          select id,type,to_char(started_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "startedAt",
          to_char(ended_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "endedAt"
          from round_segments where round_id=r.id) x) as segments,
        (select coalesce(json_agg(x order by x."receivedAt"),'[]'::json) from (
          select command_id as "commandId",segment_id as "segmentId",participant_id as "participantId",
          to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "receivedAt"
          from round_check_ins where round_id=r.id) x) as receipts,
        (select coalesce(json_agg(x order by x."appliedAt"),'[]'::json) from (
          select a.segment_id as "segmentId",a.command_id as "commandId",a.decision,
          to_char(a.effective_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "effectiveDeadline",
          to_char(a.settled_horizon at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "settledHorizon",
          to_char(c.applied_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "appliedAt"
          from round_attendance_adjudications a join round_commands c
          on c.round_id=a.round_id and c.command_id=a.command_id where a.round_id=r.id) x) as adjudications
        from rounds r where r.id=${roundId}`;
      return decodeAttendanceEvidence(JSON.stringify(row), roundId);
    });
    process.stdout.write(JSON.stringify(result));
  } catch {
    process.stderr.write(
      `${JSON.stringify({ event: 'attendance.evidence', outcome: 'refused' })}\n`,
    );
    process.exitCode = 1;
  }
}
