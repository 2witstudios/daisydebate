import { createAppError, createRefusal } from '@daisy/errors';
import { idSchema, type AttendanceLedgerFacts } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';

/** The engine's one settlement rule, injected: the db never imports the engine. */
export type AttendanceSettledRule = (
  facts: AttendanceLedgerFacts,
  nowMs: number,
) => boolean;

const iso = (column: string) =>
  sql.raw(
    `to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  );

/** Facts only: the Round's ledger, for the engine to say whether it settles. */
export async function readAttendanceLedger(
  tx: Pick<BunSQLDatabase, 'execute'>,
  roundId: string,
): Promise<AttendanceLedgerFacts> {
  const [row] = (await tx.execute(sql`select
    r.rules_snapshot->'segments' as "ruleSegments",
    coalesce((select json_agg(json_build_object('id',s.id,'rulesSegmentKey',s.rules_segment_key,'startedAt',${iso('s.started_at')}) order by s.sequence)
      from round_segments s where s.round_id=r.id and s.type='speech'),'[]'::json) as speeches,
    coalesce((select json_agg(json_build_object('segmentId',a.segment_id,'decision',a.decision,'evidence',a.evidence,
        'effectiveDeadline',${iso('a.effective_deadline')},'settledHorizon',${iso('a.settled_horizon')},'receiptParticipantId',a.receipt_participant_id))
      from round_attendance_adjudications a where a.round_id=r.id),'[]'::json) as adjudications,
    coalesce((select json_agg(json_build_object('segmentId',c.segment_id,'participantId',c.participant_id,'receivedAt',${iso('c.received_at')}))
      from round_check_ins c where c.round_id=r.id),'[]'::json) as receipts,
    exists(select 1 from round_check_in_attempts p where p.round_id=r.id and p.state='pending') as "pendingWriter"
    from rounds r where r.id=${roundId}`)) as unknown as AttendanceLedgerFacts[];
  if (!row) throw createAppError('NOT_FOUND');
  return row;
}

/** Final ballot completion only. Caller keeps its canonical authorization and Round transaction fences. */
export async function assertRoundAttendanceSettled(
  tx: Pick<BunSQLDatabase, 'execute'>,
  input: {
    readonly roundId: string;
    readonly now: string;
    readonly attendanceSettled: AttendanceSettledRule;
  },
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
  const ledger = await readAttendanceLedger(tx, input.roundId);
  if (!input.attendanceSettled(ledger, Date.parse(input.now)))
    throw createRefusal('CONFLICT', 'attendance-unsettled');
}
