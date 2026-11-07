import type { TransactionSQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import {
  advanceCleanup,
  cleanupWork as importWork,
  advanceCleanupInvoicePass,
  type CleanupInvoiceStep,
  type BillingPaymentObservation,
  billingCleanupSchema,
  startCleanup,
  type CleanupEvent,
  type CleanupState,
} from '@daisy/protocol/billing';
import { sqlStateOf } from './constraint-helpers';
import { settleCandidateRefund } from './billing-cleanup-refund.test-support';
import {
  candidateEffects,
  retainCandidateInvoice,
  retainCandidateObservation,
  readCandidateObservation,
} from './billing-cleanup-witness.test-support';
/** Mirrors runtime claim writes: claiming never rewrites microsecond queue times. */
export function cleanupCandidate(tx: TransactionSQL, initialJobId: string) {
  let jobId = initialJobId;
  const read = async () =>
    (
      await tx`select id,status,attempts,created_at,retry_at,succeeded_at,billing_cleanup from privacy_jobs where id=${jobId} for update`
    )[0]!;
  const now = async () =>
    ((await tx`select clock_timestamp() as at`)[0]!.at as Date).toISOString();
  const state = async () => {
    const row = await read();
    return billingCleanupSchema.parse(
      row.billing_cleanup ?? startCleanup(jobId, row.retry_at.toISOString()),
    );
  };
  const persist = async (value: CleanupState, kind: string) => {
    const old = await read();
    if (kind === 'claimed')
      await tx`update privacy_jobs set billing_cleanup=${JSON.stringify(value)}::text::jsonb where id=${jobId}`;
    else if (value.kind === 'acknowledged')
      await tx`update privacy_jobs set billing_cleanup=${JSON.stringify(value)}::text::jsonb,status='succeeded',succeeded_at=${value.checkedAt}::timestamptz where id=${jobId}`;
    else
      await tx`update privacy_jobs set billing_cleanup=${JSON.stringify(value)}::text::jsonb,retry_at=${value.retryAt}::timestamptz,attempts=${old.attempts + (kind === 'failure' ? 1 : 0)} where id=${jobId}`;
  };
  const apply = async (
    event: CleanupEvent,
    short: boolean | number = false,
  ) => {
    const current = await state();
    const [owner] =
      await tx`select subject_ref,deleted_at from privacy_jobs join users on users.id=subject_ref where privacy_jobs.id=${jobId}`;
    const result = advanceCleanup(current, event, {
      observationOwner: {
        userId: owner!.subject_ref,
        closedAt: owner!.deleted_at.toISOString(),
      },
      now: await now(),
      jobId,
      closed: true,
      effects: await candidateEffects(tx, jobId),
    });
    if (result.kind === 'idle')
      throw Error('Candidate matrix transition refused');
    if (short && result.state.kind !== 'acknowledged' && result.state.claim)
      result.state.claim.expiresAt = new Date(
        Date.parse(result.state.claim.claimedAt) +
          (typeof short === 'number' ? short : 200),
      ).toISOString();
    await persist(result.state, result.kind);
    return result.state;
  };
  const applyInvoice = async (
    step: CleanupInvoiceStep,
    witness: BillingPaymentObservation,
  ) => {
    const current = await state();
    const result = advanceCleanupInvoicePass(
      current,
      { claimId: token(current), work: importWork(current)!, step, witness },
      {
        now: await now(),
        jobId,
        closed: true,
        observationOwner: {
          userId: witness.userId,
          closedAt: witness.closedAt,
        },
        effects: await candidateEffects(tx, jobId),
      },
    );
    if (result.kind !== 'progress')
      throw Error('Candidate invoice pass refused');
    await persist(result.state, 'progress');
    return result.state;
  };
  const claim = async (short: boolean | number = false) => {
    await tx`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+0.01) from privacy_jobs where id=${jobId}`;
    return apply({ kind: 'claim', claimId: createId() }, short);
  };
  const token = (value: CleanupState) => {
    if (value.kind === 'acknowledged' || !value.claim)
      throw Error('Missing matrix claim');
    return value.claim.id;
  };
  const probe = async (work: () => Promise<unknown>) => {
    await tx`savepoint owned_candidate_probe`;
    const code = await sqlStateOf(work);
    await tx`rollback to savepoint owned_candidate_probe`;
    await tx`release savepoint owned_candidate_probe`;
    return code;
  };
  const rotate = async () => {
    const oldId = jobId;
    jobId = createId();
    await tx`update privacy_jobs set id=${jobId},status='pending',attempts=0,created_at=clock_timestamp(),retry_at=clock_timestamp(),succeeded_at=null where id=${oldId}`;
    return oldId;
  };
  return {
    get jobId() {
      return jobId;
    },
    read,
    now,
    state,
    persist,
    apply,
    applyInvoice,
    claim,
    token,
    probe,
    rotate,
    settleRefund: (id: string) => settleCandidateRefund(tx, jobId, id),
    observationIds: async () =>
      (
        await tx`select id from billing_payment_observations where user_id=(select subject_ref from privacy_jobs where id=${jobId}) order by id limit 20`
      ).map((row: { id: string }) => row.id) as string[],
    readObservation: (id: string) => readCandidateObservation(tx, jobId, id),
    retainObservation: (id: string) =>
      retainCandidateObservation(tx, jobId, id),
    retainInvoice: (invoiceId: string, paymentId?: string) =>
      retainCandidateInvoice(tx, jobId, invoiceId, paymentId),
  };
}
