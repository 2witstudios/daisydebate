import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type { BoundedTransaction } from '../bounded-transaction';
import { requireLeaseMs } from '../lease-policy';
import { claim } from './claim';
import { finish } from './finish';
import { receipt } from './receipt';
/** Uses the existing bounded competitive transaction; no second pool, vendor calls or account lock upgrades. */
export function create(options: {
  readonly run: BoundedTransaction;
  readonly leaseMs: number;
  readonly retryMs: number;
  readonly nextToken: () => string;
}) {
  requireLeaseMs(options.leaseMs);
  if (
    !Number.isSafeInteger(options.retryMs) ||
    options.retryMs < 1000 ||
    options.retryMs > 300000 ||
    typeof options.nextToken !== 'function'
  )
    throw createAppError('VALIDATION');
  const claimInput = z.strictObject({
    workerId: idSchema,
    lane: z.enum(['attached', 'detached']),
  });
  return {
    claim(raw: unknown) {
      const input = claimInput.safeParse(raw);
      if (!input.success) throw createAppError('VALIDATION');
      return options.run((tx) => claim(tx, input.data, options));
    },
    complete(raw: unknown) {
      const input = receipt.safeParse(raw);
      if (!input.success) throw createAppError('VALIDATION');
      return options.run((tx) => finish(tx, input.data, null));
    },
    retry(raw: unknown) {
      const input = receipt.safeParse(raw);
      if (!input.success) throw createAppError('VALIDATION');
      return options.run((tx) => finish(tx, input.data, options.retryMs));
    },
  };
}
