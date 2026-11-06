import { z } from 'zod';
import type { Database } from '@daisy/db';
import type { CleanupDeliveryRequest as Request } from './cleanup-delivery-request';
import type { CleanupVendorPort } from './cleanup-vendor';
type Store = Pick<ReturnType<Database['billingCleanup']>, 'inspect' | 'record'>;
type Resources = {
  readonly store: Store;
  readonly port: Pick<CleanupVendorPort, 'customer' | 'deleteCustomer'>;
  readonly mode: 'test' | 'live';
  readonly running: () => boolean;
};
type Current = Extract<
  Awaited<ReturnType<Store['inspect']>>,
  { kind: 'current' }
>;
const customerSchema = z.object({
  object: z.literal('customer'),
  id: z.string(),
  livemode: z.boolean(),
});
const deletedSchema = z.object({
  object: z.literal('customer'),
  id: z.string(),
  deleted: z.literal(true),
});
const deleted = (value: unknown, id: string) => {
  const result = deletedSchema.safeParse(value);
  return result.success && result.data.id === id;
};

/** Current obligations and claim authority are re-read before every effect and final acknowledgement. */
export function createCleanupCustomerDelivery(input: Resources) {
  return async (request: Request) => {
    if (request.work.kind !== 'delete') return 'unhandled' as const;
    if (!input.running()) return 'idle' as const;
    return deliverCurrent(input, request);
  };
}
async function deliverCurrent(input: Resources, request: Request) {
  const current = await input.store.inspect(
    request.jobId,
    request.claimId,
    request.work,
  );
  if (current.kind !== 'current') return 'idle' as const;
  const fail = () =>
    input.store.record(request.jobId, {
      kind: 'failure',
      claimId: request.claimId,
      work: request.work,
      retryAt: request.retryAt,
    });
  const customerId = availableCustomer(current.facts, input.mode);
  if (customerId === null) return fail();
  if (!input.running()) return 'idle' as const;
  let reply: unknown;
  try {
    reply = await input.port.customer(customerId);
  } catch {
    return input.running() ? fail() : ('idle' as const);
  }
  if (!input.running()) return 'idle' as const;
  const result = deleted(reply, customerId)
    ? 'deleted'
    : await deleteOwned(input, request, customerId, reply);
  if (result === 'idle') return 'idle' as const;
  // Raw vendor success remains a proposal; current SQL/app completion gates own acceptance.
  return result === 'deleted'
    ? input.store.record(request.jobId, {
        kind: 'deleted',
        claimId: request.claimId,
        work: request.work,
      })
    : fail();
}
async function deleteOwned(
  input: Resources,
  request: Request,
  customerId: string,
  value: unknown,
) {
  if (!ownsCustomer(value, customerId, input.mode))
    return 'unresolved' as const;
  const fresh = await input.store.inspect(
    request.jobId,
    request.claimId,
    request.work,
  );
  if (!input.running() || fresh.kind !== 'current') return 'idle' as const;
  if (availableCustomer(fresh.facts, input.mode) !== customerId)
    return 'unresolved' as const;
  let reply: unknown;
  try {
    reply = await input.port.deleteCustomer(customerId);
  } catch {
    return input.running() ? ('unresolved' as const) : ('idle' as const);
  }
  if (!input.running()) return 'idle' as const;
  return deleted(reply, customerId)
    ? ('deleted' as const)
    : ('unresolved' as const);
}
function availableCustomer(facts: Current['facts'], mode: Resources['mode']) {
  return facts.route.kind === 'owned' &&
    facts.route.mode === mode &&
    !facts.effects.owedFinancialEffects
    ? facts.route.customerId
    : null;
}
function ownsCustomer(value: unknown, id: string, mode: Resources['mode']) {
  const parsed = customerSchema.safeParse(value);
  return (
    parsed.success &&
    parsed.data.id === id &&
    parsed.data.livemode === (mode === 'live')
  );
}
