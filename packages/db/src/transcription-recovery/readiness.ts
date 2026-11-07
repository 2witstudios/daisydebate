import { sql, type SQL } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransactionContext } from '../transaction-context';
/** A known retained original cannot disappear merely because selective restore omitted its recognition metadata. */
export const hasUnenrolledOriginals = (roundId: string | SQL) =>
  sql`exists(select 1 from necessary_evidence pending
    where pending.original_round_id=${roundId} and pending.state='retained'
      and pending.payload_accepted_at is not null
      and not exists(select 1 from transcription_recovery_sources enrolled where enrolled.evidence_id=pending.id))`;
/** Caller owns original accounts→Round; this reads metadata, never raw payload or replacement capture authority. */
export async function requireOriginalEnrollment(
  tx: BoundedTransactionContext,
  roundId: string,
) {
  const [row] = await tx.execute(
    sql`select ${hasUnenrolledOriginals(roundId)} as pending`,
  );
  if (!row || row.pending)
    throw createAppError(
      'CONFLICT',
      'Original recognition enrollment is incomplete',
    );
}
