import { createAppError } from '@daisy/errors';
import { attendanceTimingPolicy, idSchema } from '@daisy/protocol';
import { sql, type SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
/** Final ballot completion only. Caller keeps its canonical authorization and Round transaction fences. */
export async function assertRoundAttendanceSettled(
  tx: Pick<BunSQLDatabase, 'execute'>,
  input: { readonly roundId: string; readonly now: string },
): Promise<void> {
  if (
    !idSchema.safeParse(input.roundId).success ||
    !Number.isFinite(Date.parse(input.now))
  )
    throw createAppError('VALIDATION');
  const locked = await tx.execute(
    sql`select id from rounds where id=${input.roundId} for no key update`,
  );
  if (locked.length !== 1) throw createAppError('NOT_FOUND');
  const [row] = await tx.execute(
    sql`select ${unresolvedAttendance(sql`${input.roundId}`, sql`${input.now}::timestamptz`)} as unresolved`,
  );
  if ((row as { unresolved: boolean }).unresolved)
    throw createAppError('CONFLICT', 'attendance-unsettled');
}

/** One authoritative settlement predicate for finalizers, rating discovery and locked posting. */
export const unresolvedAttendance = (roundId: SQL, now: SQL) => sql`exists(
  select 1 from round_segments s join rounds attendance_round on attendance_round.id=s.round_id
  left join round_attendance_adjudications a on a.round_id=s.round_id and a.segment_id=s.id
  where s.round_id=${roundId} and s.type='speech'
   and s.rules_segment_key is distinct from (
    select value->>'key' from jsonb_array_elements(attendance_round.rules_snapshot->'segments') with ordinality as rule(value,ordinal)
    where value->>'type'='speech' order by ordinal desc limit 1)
   and (a.segment_id is null or a.effective_deadline < s.started_at+${attendanceTimingPolicy.graceMs}*interval '1 millisecond' or a.settled_horizon < a.effective_deadline+${attendanceTimingPolicy.finalizationBufferMs}*interval '1 millisecond'
    or a.effective_deadline > ${now}::timestamptz-${attendanceTimingPolicy.finalizationBufferMs}*interval '1 millisecond'
    or a.decision in ('forfeit','abandoned'))
 ) or exists(select 1 from round_check_in_attempts where round_id=${roundId} and state='pending')`;
