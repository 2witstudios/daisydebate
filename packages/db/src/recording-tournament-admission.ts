import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { Tx } from './tx';
import { run, query } from './raw-rows';

/** Recording's named minimal input; funding/issuer/official identities stay in the owning admission. */
export const readRecordingTournamentAdmission = async (
  tx: Tx,
  roundId: string,
) => {
  const [row] = await query(
    tx,
    z.object({
      admissionId: z.string(),
      roundId: z.string(),
      deadlineAt: z.date(),
    }),
    sql`select * from public.daisy_recording_tournament_admission(${roundId})`,
  );
  if (!row) return null;
  if (row.roundId !== roundId) throw createAppError('INFRASTRUCTURE');
  return {
    admissionId: row.admissionId,
    roundId,
    deadlineAt: row.deadlineAt.toISOString(),
  };
};

/** Pins the admission before a capture-attempt lock; also locks a settled source so it cannot be reopened. */
export const readLockedTournamentAdmission = async (
  tx: Tx,
  roundId: string,
) => {
  await run(
    tx,
    sql`select * from public.daisy_lock_recording_tournament_admission(${roundId})`,
  );
};

export const listExpiredRecordingAdmissions = async (tx: Tx, limit: number) => {
  const rows = await query(
    tx,
    z.strictObject({ roundId: idSchema }),
    sql`select * from public.daisy_recording_expired_tournament_admissions(${limit})`,
  );
  if (rows.length > 100) throw createAppError('INFRASTRUCTURE');
  return rows;
};
export const settleUndispatchedRecordingAdmission = async (
  tx: Tx,
  roundId: string,
) => {
  const [row] = await query(
    tx,
    z.object({ settled: z.boolean() }),
    sql`select public.daisy_recording_settle_undispatched_tournament_admission(${roundId}) as settled`,
  );
  return row?.settled === true;
};
