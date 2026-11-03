import { idSchema } from '@daisy/protocol';
import { readLaunchDatabase } from './launch-evidence-database';

const at = (column: string) =>
  `to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Read-only facts about one drilled Round; no text, no identity beyond opaque ids. */
if (import.meta.main) {
  try {
    const roundId = idSchema.parse(Bun.argv[2]);
    const result = await readLaunchDatabase(async (tx) => {
      const [row] = await tx.unsafe(
        `select r.status,
          ${at('statement_timestamp()')} as "observedAt",
          (select coalesce(json_agg(x),'[]'::json) from (
            select ${at('unsafe_at')} as "unsafeAt",reconcile_last_pass_clean as "lastPassClean",
              ${at('ended_at')} as "endedAt"
            from media_sessions where round_id=r.id) x) as sessions,
          (select coalesce(json_agg(x order by x."startedAt"),'[]'::json) from (
            select id,${at('started_at')} as "startedAt",${at('ended_at')} as "endedAt",duration_ms as "durationMs"
            from round_segments where round_id=r.id and type='speech') x) as segments,
          (select coalesce(json_agg(x),'[]'::json) from (
            select segment_id as "segmentId",round_participant_id as "participantId",
              ${at('started_at')} as "startedAt",${at('ended_at')} as "endedAt"
            from round_speaking_intervals where round_id=r.id) x) as grants,
          (select coalesce(json_agg(x),'[]'::json) from (
            select segment_id as "segmentId",round_participant_id as "participantId",
              ${at('observed_from')} as "from",${at('observed_until')} as "until"
            from transcript_observations where round_id=r.id) x) as observations,
          (select coalesce(json_agg(x),'[]'::json) from (
            select decision from round_attendance_adjudications where round_id=r.id) x) as adjudications
        from rounds r where r.id=$1`,
        [roundId],
      );
      const [table] = await tx.unsafe(
        `select to_regclass('public.round_incidents') is not null as present`,
      );
      if (!table.present)
        return { ...row, incidents: null, resumePoints: [], returnedMs: 0 };
      const incidents = await tx.unsafe(
        `select to_char(resume_point at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "resumePoint",
          returned_ms as "returnedMs"
        from round_incidents where round_id=$1`,
        [roundId],
      );
      return {
        ...row,
        incidents: incidents.length,
        resumePoints: incidents.flatMap(
          (incident: { resumePoint: string | null }) =>
            incident.resumePoint ? [incident.resumePoint] : [],
        ),
        returnedMs: incidents.reduce(
          (sum: number, incident: { returnedMs: number }) =>
            sum + incident.returnedMs,
          0,
        ),
      };
    });
    process.stdout.write(JSON.stringify(result));
  } catch {
    process.stderr.write(
      `${JSON.stringify({ event: 'node.kill.drill.evidence', outcome: 'refused' })}\n`,
    );
    process.exitCode = 1;
  }
}
