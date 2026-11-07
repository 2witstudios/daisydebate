import { eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransactionContext } from '../transaction-context';
import { transcriptionRecoveryEnrollmentProgress as progress } from '../schema/transcription-recovery-enrollment-progress';
import { missingRounds } from './missing-rounds';
/** Commit a bounded finite-pass position before external work; a crash defers a unit to the next pass, never deletes it. */
export async function missing(tx: BoundedTransactionContext) {
  const [position] = await tx
    .select({ singleton: progress.singleton })
    .from(progress)
    .where(eq(progress.singleton, true))
    .for('update');
  if (!position)
    throw createAppError(
      'INFRASTRUCTURE',
      'Enrollment scan position unavailable',
    );
  // Sample after the scan lock wait. Do not round-trip microsecond cursor keys through JavaScript Date.
  const [due] = (await tx.execute(
    sql`select next_scan_at<=clock_timestamp() as due from transcription_recovery_enrollment_progress where singleton`,
  )) as unknown as { due: boolean }[];
  if (!due?.due) return [];
  return (await tx.execute(sql`with
 eligible as materialized(${missingRounds}),
 head as materialized(select turn_at,round_id from eligible order by turn_at desc,round_id desc limit 1),
 bounds as materialized(select p.*,coalesce(p.until_at,h.turn_at) as ceiling_at,coalesce(p.until_round_id,h.round_id) as ceiling_round_id
  from transcription_recovery_enrollment_progress p left join head h on true where p.singleton),
 page as materialized(select e.* from eligible e cross join bounds b
  where (b.after_at is null or (e.turn_at,e.round_id)>(b.after_at,b.after_round_id))
   and (e.turn_at,e.round_id)<=(b.ceiling_at,b.ceiling_round_id)
  order by e.turn_at,e.round_id limit 8),
 last_seen as materialized(select turn_at,round_id from page order by turn_at desc,round_id desc limit 1),
 offered as(insert into transcription_recovery_enrollment_offers(evidence_id,last_offered_at)
  select page.evidence_id,clock_timestamp() from page
  on conflict(evidence_id) do update set last_offered_at=excluded.last_offered_at returning evidence_id),
 changed as(update transcription_recovery_enrollment_progress p set
  after_at=case when (l.turn_at,l.round_id)<(b.ceiling_at,b.ceiling_round_id) then l.turn_at else null end,
  after_round_id=case when (l.turn_at,l.round_id)<(b.ceiling_at,b.ceiling_round_id) then l.round_id else null end,
  until_at=case when (l.turn_at,l.round_id)<(b.ceiling_at,b.ceiling_round_id) then b.ceiling_at else null end,
  until_round_id=case when (l.turn_at,l.round_id)<(b.ceiling_at,b.ceiling_round_id) then b.ceiling_round_id else null end,
  next_scan_at=clock_timestamp()+interval '1 second'
  from bounds b left join last_seen l on true where p.singleton returning p.singleton)
 select page.round_id as "roundId",page.evidence_id as "evidenceId" from page join offered on offered.evidence_id=page.evidence_id cross join changed order by page.turn_at,page.round_id`)) as unknown as {
    roundId: string;
    evidenceId: string;
  }[];
}
