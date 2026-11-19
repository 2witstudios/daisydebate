import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { Tx } from './tx';

/** Recording's named minimal input; funding/issuer/official identities stay in the owning admission. */
export const readRecordingTournamentAdmission = async (
  tx: Tx,
  roundId: string,
) => {
  const [row] = await tx.execute(
    sql`select * from public.daisy_recording_tournament_admission(${roundId})`,
  );
  if (!row) return null;
  const value = row as {
    admissionId: unknown;
    roundId: unknown;
    deadlineAt: unknown;
  };
  if (
    typeof value.admissionId !== 'string' ||
    value.roundId !== roundId ||
    !(value.deadlineAt instanceof Date) ||
    !Number.isFinite(value.deadlineAt.getTime())
  )
    throw createAppError('INFRASTRUCTURE');
  return {
    admissionId: value.admissionId,
    roundId,
    deadlineAt: value.deadlineAt.toISOString(),
  };
};

/** Pins the admission before a capture-attempt lock; also locks a settled source so it cannot be reopened. */
export const readLockedTournamentAdmission = async (
  tx: Tx,
  roundId: string,
) => {
  await tx.execute(
    sql`select * from public.daisy_lock_recording_tournament_admission(${roundId})`,
  );
};

export const listExpiredRecordingAdmissions = async (tx: Tx, limit: number) => {
  const rows = await tx.execute(
    sql`select * from public.daisy_recording_expired_tournament_admissions(${limit})`,
  );
  const parsed = z
    .array(z.strictObject({ roundId: idSchema }))
    .max(100)
    .safeParse(rows);
  if (!parsed.success) throw createAppError('INFRASTRUCTURE');
  return parsed.data;
};
export const settleUndispatchedRecordingAdmission = async (
  tx: Tx,
  roundId: string,
) => {
  const [row] = await tx.execute(
    sql`select public.daisy_recording_settle_undispatched_tournament_admission(${roundId}) as settled`,
  );
  return (row as { settled?: unknown } | undefined)?.settled === true;
};
