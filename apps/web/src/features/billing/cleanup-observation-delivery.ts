import { hasObservationConflict } from './cleanup-observation-conflict';
import type { Database } from '@daisy/db';
import type { CleanupDeliveryRequest } from './cleanup-delivery-request';
import type { createPaymentObservationReader } from './payment-observation-reader';
type Store = Pick<
  ReturnType<Database['billingCleanup']>,
  | 'observations'
  | 'selectedObservation'
  | 'retainObservation'
  | 'revisitPayment'
  | 'recordPayment'
  | 'record'
>;

/** Observation traversal uses exact current keysets; historical resolution alone never substitutes for a vendor reread. */
export function createCleanupObservationDelivery(input: {
  readonly store: Store;
  readonly read: ReturnType<typeof createPaymentObservationReader>;
  readonly running: () => boolean;
}) {
  return async (request: CleanupDeliveryRequest) => {
    const { work } = request;
    if (work.kind !== 'scan' || work.lane !== 'observations')
      return 'unhandled' as const;
    if (!input.running()) return 'idle' as const;
    if (work.scan.kind === 'page') return retainPage(request);
    if (work.scan.kind !== 'selected') return 'idle' as const;
    return selectedPayment(request);
  };
  async function retainPage({ jobId, claimId, work }: CleanupDeliveryRequest) {
    if (work.kind !== 'scan' || work.scan.kind !== 'page')
      return 'idle' as const;
    const rows = await input.store.observations(
      jobId,
      claimId,
      work,
      work.scan.afterId,
    );
    if (rows.kind !== 'observations' || !input.running())
      return 'idle' as const;
    return input.store.record(jobId, {
      kind: 'page',
      claimId,
      work,
      ids: rows.observations.map((row) => row.id),
      more: rows.more,
    });
  }
  async function selectedPayment({
    jobId,
    claimId,
    work,
    retryAt,
  }: CleanupDeliveryRequest) {
    const fail = () =>
      input.store.record(jobId, { kind: 'failure', claimId, work, retryAt });
    const selected = await input.store.selectedObservation(
      jobId,
      claimId,
      work,
    );
    if (selected.kind !== 'observation' || !input.running())
      return 'idle' as const;
    const row = selected.observation;
    if (row.kind !== 'payment') return 'unhandled' as const;
    if (hasObservationConflict(row))
      return input.store.retainObservation(jobId, claimId, work);
    const read = await input.read({
      invoice: {
        mode: row.mode,
        customerId: row.customerId,
        invoiceId: row.invoiceId,
        source: row.source,
      },
      paymentId: row.invoicePaymentId,
      closedAt: row.closedAt,
    });
    if (!input.running()) return 'idle' as const;
    if (read.kind !== 'read') return fail();
    const result = await input.store.revisitPayment(
      jobId,
      claimId,
      work,
      read.read,
    );
    if (result !== 'idle' || !input.running()) return result;
    const late = await input.store.recordPayment(row.userId, read.read);
    return late === 'recorded' ? ('reopened' as const) : ('idle' as const);
  }
}
