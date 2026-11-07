import type { Database } from '@daisy/db';
import type { CleanupDeliveryRequest as Request } from './cleanup-delivery-request';
import { readOwnedSubscription } from './subscription-observation';
import type { CleanupVendorPort } from './cleanup-vendor';
type Store = Pick<
  ReturnType<Database['billingCleanup']>,
  'frozenOffer' | 'record'
>;
type Resources = {
  readonly store: Store;
  readonly port: Pick<CleanupVendorPort, 'subscription' | 'cancelSubscription'>;
  readonly mode: 'test' | 'live';
  readonly running: () => boolean;
};
type OwnedOffer = Extract<
  Awaited<ReturnType<Store['frozenOffer']>>,
  { kind: 'owned' }
>;

/** Re-read exact claim authority before cancellation; unknown replies retain the selected business identity. */
export function createCleanupSubscriptionDelivery(input: Resources) {
  return async (request: Request) => {
    const { work } = request;
    if (
      work.kind !== 'scan' ||
      work.lane !== 'subscriptions' ||
      work.scan.kind !== 'selected'
    )
      return 'unhandled' as const;
    if (!input.running()) return 'idle' as const;
    return deliverSelected(input, request, work.scan.id);
  };
}

async function deliverSelected(
  input: Resources,
  request: Request,
  subscriptionId: string,
) {
  const { jobId, claimId, work, retryAt } = request;
  const fail = () =>
    input.store.record(jobId, { kind: 'failure', claimId, work, retryAt });
  const original = await input.store.frozenOffer(
    jobId,
    claimId,
    work,
    subscriptionId,
  );
  if (original.kind !== 'owned' || original.owner.mode !== input.mode)
    return fail();
  if (!input.running()) return 'idle' as const;
  const current = await retrieveOwned(input, original, subscriptionId);
  if (!input.running()) return 'idle' as const;
  if (!current) return fail();
  const result =
    current.status === 'canceled'
      ? 'canceled'
      : await cancelCurrent(input, request, original, subscriptionId);
  if (result === 'idle') return 'idle' as const;
  // Database/service failures propagate; only transport failures become vendor retry.
  return result === 'canceled'
    ? input.store.record(jobId, { kind: 'resolved', claimId, work })
    : fail();
}

async function cancelCurrent(
  input: Resources,
  request: Request,
  original: OwnedOffer,
  subscriptionId: string,
) {
  const { jobId, claimId, work } = request;
  const fresh = await input.store.frozenOffer(
    jobId,
    claimId,
    work,
    subscriptionId,
  );
  if (!input.running()) return 'idle' as const;
  if (
    fresh.kind !== 'owned' ||
    JSON.stringify(fresh) !== JSON.stringify(original)
  )
    return 'unresolved' as const;
  let reply: unknown;
  try {
    reply = await input.port.cancelSubscription(subscriptionId);
  } catch {
    // Possible cancellation stays owed; recovery first retrieves this same subscription.
    return input.running() ? ('unresolved' as const) : ('idle' as const);
  }
  if (!input.running()) return 'idle' as const;
  return readOwnedSubscription(original.owner, reply)?.status === 'canceled'
    ? ('canceled' as const)
    : ('unresolved' as const);
}

async function retrieveOwned(
  input: Resources,
  original: OwnedOffer,
  subscriptionId: string,
) {
  let value: unknown;
  try {
    value = await input.port.subscription(subscriptionId);
  } catch {
    return null;
  }
  return readOwnedSubscription(original.owner, value);
}
