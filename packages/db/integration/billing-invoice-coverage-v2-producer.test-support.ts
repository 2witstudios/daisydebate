import type { TransactionSQL } from 'bun';
import {
  advanceCleanup,
  advanceCleanupInvoicePass,
  billingCleanupSchema,
  cleanupWork,
  type CleanupEvent,
  type CleanupInvoiceStep,
  type BillingPaymentObservation,
  type CleanupState,
} from '@daisy/protocol/billing';
import { claimHistoricalInvoicePassV2 } from './billing-invoice-pass-v2.test-support';
import { candidateEffects } from './billing-cleanup-witness.test-support';

/** Test-only outer-wire translation; every write must pass the actual immutable112 guard. */
export async function claimedV2(tx: TransactionSQL, jobId: string) {
  const raw = await claimHistoricalInvoicePassV2(tx, jobId);
  return billingCleanupSchema.parse({ ...raw, version: 3 });
}
async function context(tx: TransactionSQL, jobId: string) {
  const [owner] =
    await tx`select job.subject_ref,account.deleted_at,clock_timestamp() as at from privacy_jobs job join users account on account.id=job.subject_ref where job.id=${jobId}`;
  return {
    jobId,
    now: owner!.at.toISOString(),
    closed: true,
    observationOwner: {
      userId: owner!.subject_ref,
      closedAt: owner!.deleted_at.toISOString(),
    },
    effects: await candidateEffects(tx, jobId),
  };
}
async function persistV2(
  tx: TransactionSQL,
  jobId: string,
  state: CleanupState,
) {
  if (state.kind === 'acknowledged')
    throw Error('Historical producer cannot invent completion');
  await tx`update privacy_jobs set billing_cleanup=${JSON.stringify({ ...state, version: 2 })}::text::jsonb,retry_at=${state.retryAt}::timestamptz where id=${jobId}`;
}
export async function pageV2(tx: TransactionSQL, jobId: string) {
  const state = await claimedV2(tx, jobId);
  if (state.kind === 'acknowledged' || !state.claim)
    throw Error('Missing current historical claim');
  const event: CleanupEvent = {
    kind: 'page',
    claimId: state.claim.id,
    work: cleanupWork(state)!,
    ids: [],
    more: false,
  };
  const result = advanceCleanup(state, event, await context(tx, jobId));
  if (result.kind !== 'progress')
    throw Error('Historical empty producer page refused');
  await persistV2(tx, jobId, result.state);
  return result.state;
}
export async function invoiceStepV2(
  tx: TransactionSQL,
  jobId: string,
  step: CleanupInvoiceStep,
  witness: BillingPaymentObservation,
) {
  const state = await claimedV2(tx, jobId);
  if (state.kind === 'acknowledged' || !state.claim)
    throw Error('Missing current historical invoice claim');
  const result = advanceCleanupInvoicePass(
    state,
    { claimId: state.claim.id, work: cleanupWork(state)!, step, witness },
    await context(tx, jobId),
  );
  if (result.kind !== 'progress')
    throw Error('Historical invoice step refused');
  await persistV2(tx, jobId, result.state);
  return result.state;
}
