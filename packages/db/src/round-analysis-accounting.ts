import { createAppError } from '@daisy/errors';
import {
  analysisRequest,
  analysisUsageOutcome,
  type AnalysisWork,
} from '@daisy/protocol';
import { usageStateSchema } from '@daisy/protocol/billing';
import { and, eq } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';
import type { AnalysisSeat } from './round-analysis-authority';
import { usageReservations } from './schema/usage-reservations';
import { advanceUsageLocked } from './usage-ledger';

type AccountingInput = AnalysisSeat & {
  readonly actorId: string;
  readonly erased: boolean;
  readonly work: AnalysisWork;
};
async function reservation(
  tx: BoundedTransactionContext,
  input: AccountingInput,
) {
  const request = analysisRequest(input.work);
  if (!request) return null;
  const [row] = await tx
    .select()
    .from(usageReservations)
    .where(
      and(
        eq(usageReservations.actorId, input.actorId),
        eq(usageReservations.roundId, input.roundId),
        eq(usageReservations.kind, 'round_analysis'),
      ),
    )
    .for('update');
  if (!row && input.erased) return null;
  if (!row || row.reservedAt.toISOString() !== request.requestedAt)
    throw createAppError('INVARIANT', 'Analysis reservation identity missing');
  return row;
}
/** The feature's first durable dispatch and the one ledger's count commit together. */
export async function countAnalysisDispatch(
  tx: BoundedTransactionContext,
  input: AccountingInput & { readonly before: string },
) {
  const row = await reservation(tx, input);
  if (!row || input.erased) throw createAppError('AUTHORIZATION');
  await advanceUsageLocked(tx, {
    reservationId: row.id,
    actorId: input.actorId,
    roundId: input.roundId,
    authorized: true,
    event: { kind: 'dispatch', before: input.before },
  });
}
/** Late provider facts resolve exposure, never recreate erased accounting or new allowance. */
export async function settleAnalysisUsage(
  tx: BoundedTransactionContext,
  input: AccountingInput,
) {
  const outcome = analysisUsageOutcome(input.work);
  if (outcome === 'pending') return;
  const row = await reservation(tx, input);
  if (!row) return;
  const state = usageStateSchema.parse(row.state);
  if (outcome === 'unspent' && state.kind === 'released') return;
  if (outcome === 'unspent' && state.kind !== 'reserved')
    throw createAppError(
      'INVARIANT',
      'Counted analysis has no dispatch evidence',
    );
  await advanceUsageLocked(tx, {
    reservationId: row.id,
    actorId: input.actorId,
    roundId: input.roundId,
    authorized: false,
    event:
      outcome === 'unspent' ? { kind: 'abandon' } : { kind: 'settle', outcome },
  });
}
