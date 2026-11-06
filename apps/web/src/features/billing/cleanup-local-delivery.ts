import type { Database } from '@daisy/db';
import type { CleanupDeliveryRequest } from './cleanup-delivery-request';

type Store = Pick<
  ReturnType<Database['billingCleanup']>,
  'resources' | 'record'
>;

/** Purchase/refund workers own vendor recovery; cleanup consumes only their current fenced facts. */
export function createLocalCleanupDelivery(input: {
  readonly store: Store;
  readonly running: () => boolean;
}) {
  const { store } = input;
  return async (request: CleanupDeliveryRequest) => {
    const { jobId, claimId, work, retryAt } = request;
    if (
      work.kind !== 'scan' ||
      (work.lane !== 'purchases' && work.lane !== 'refunds')
    )
      return 'unhandled' as const;
    if (!input.running()) return 'idle' as const;
    const resource = await store.resources(jobId, claimId, work);
    if (resource.kind === 'refuse' || !input.running()) return 'idle' as const;
    if (resource.kind === 'page')
      return store.record(jobId, {
        kind: 'page',
        claimId,
        work,
        ids: resource.ids,
        more: resource.more,
      });
    const complete = resourceCompleted(resource);
    // The record transaction re-reads the original owned action/purchase; this projection is not authority.
    return store.record(
      jobId,
      complete
        ? { kind: 'resolved', claimId, work }
        : { kind: 'failure', claimId, work, retryAt },
    );
  };
}

function resourceCompleted(
  resource: Exclude<
    Awaited<ReturnType<Store['resources']>>,
    { kind: 'page' | 'refuse' }
  >,
) {
  return resource.kind === 'refund'
    ? resource.action.state.kind === 'known' &&
        resource.action.state.status === 'succeeded'
    : ['complete', 'expired', 'abandoned'].includes(
        resource.purchase.state.kind,
      );
}
