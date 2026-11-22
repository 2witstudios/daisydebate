import { tryInstantMs, instantMs } from '@daisy/clock';
import { createAppError, createRefusal } from '@daisy/errors';
import {
  attendanceLedgerFactsSchema,
  type AttendanceLedgerFacts,
} from '@daisy/protocol/attendance';
import { idSchema } from '@daisy/protocol/primitives';
import { sql } from 'drizzle-orm';
import type { Tx } from './tx';
import { query } from './raw-rows';
import { z } from 'zod';

/** The engine's one settlement rule, injected: the db never imports the engine. */
export type AttendanceSettledRule = (
  facts: AttendanceLedgerFacts,
  nowMs: number,
) => boolean;

const iso = (column: string) =>
  sql.raw(
    `to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  );

/** The ledger's columns over the Round alias `r`, for any read of these facts. */
export const attendanceLedgerColumns = sql`
    r.rules_snapshot->'segments' as "ruleSegments",
    coalesce((select json_agg(json_build_object('id',s.id,'rulesSegmentKey',s.rules_segment_key,'startedAt',${iso('s.started_at')}) order by s.sequence)
      from round_segments s where s.round_id=r.id and s.type='speech'),'[]'::json) as speeches,
    coalesce((select json_agg(json_build_object('segmentId',a.segment_id,'decision',a.decision,'evidence',a.evidence,
        'effectiveDeadline',${iso('a.effective_deadline')},'settledHorizon',${iso('a.settled_horizon')},'receiptParticipantId',a.receipt_participant_id))
      from round_attendance_adjudications a where a.round_id=r.id),'[]'::json) as adjudications,
    coalesce((select json_agg(json_build_object('segmentId',c.segment_id,'participantId',c.participant_id,'receivedAt',${iso('c.received_at')}))
      from round_check_ins c where c.round_id=r.id),'[]'::json) as receipts,
    exists(select 1 from round_check_in_attempts p where p.round_id=r.id and p.state='pending') as "pendingWriter"`;

/** A ledger row as the engine's facts: a row outside its evidence's shape is corruption. */
export const attendanceLedgerFacts = (row: unknown): AttendanceLedgerFacts => {
  const parsed = attendanceLedgerFactsSchema.safeParse(row);
  if (!parsed.success)
    throw createAppError('INVARIANT', 'An attendance ledger row is corrupt');
  return parsed.data;
};

/** Facts only: the Round's ledger, for the engine to say whether it settles. */
export async function readAttendanceLedger(
  tx: Tx,
  roundId: string,
): Promise<AttendanceLedgerFacts> {
  const [row] = await query(
    tx,
    attendanceLedgerFactsSchema,
    sql`select ${attendanceLedgerColumns}
    from rounds r where r.id=${roundId}`,
  );
  if (!row) throw createAppError('NOT_FOUND');
  return row;
}

/** Final ballot completion only. Caller keeps its canonical authorization and Round transaction fences. */
export async function assertRoundAttendanceSettled(
  tx: Tx,
  input: {
    readonly roundId: string;
    readonly now: string;
    readonly attendanceSettled: AttendanceSettledRule;
  },
): Promise<void> {
  if (
    !idSchema.safeParse(input.roundId).success ||
    tryInstantMs(input.now) === undefined
  )
    throw createAppError('VALIDATION');
  const locked = await query(
    tx,
    z.object({ id: z.string() }),
    sql`select id from rounds where id=${input.roundId} for no key update`,
  );
  if (locked.length !== 1) throw createAppError('NOT_FOUND');
  const ledger = await readAttendanceLedger(tx, input.roundId);
  if (!input.attendanceSettled(ledger, instantMs(input.now)))
    throw createRefusal('CONFLICT', 'attendance-unsettled');
}
