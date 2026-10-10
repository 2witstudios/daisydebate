import type { Clock } from '@daisy/clock';
import type { createDatabase } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import {
  createRetentionSweep,
  startRetentionSweep,
  type Timers,
} from './retention-sweep';

/** Explicit reservation expiry/deletion cadence; no collection or retention approval is inferred. */
export function startMessagingFileMaintenance(input: {
  readonly maintenance: ReturnType<
    typeof createDatabase
  >['messagingFileMaintenance'];
  readonly config: { readonly intervalMs: number; readonly maxItems: number };
  readonly remove: (key: string) => Promise<void>;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly timers: Timers;
}) {
  const { intervalMs, maxItems } = input.config;
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 1 ||
    intervalMs > 2147483647 ||
    !Number.isSafeInteger(maxItems) ||
    maxItems < 1 ||
    maxItems > 65535
  )
    throw createAppError('VALIDATION');
  const sweep = createRetentionSweep({
    clock: input.clock,
    logger: input.logger,
    targets: [
      {
        name: 'retention.messaging_files',
        batchSize: maxItems,
        maxBatches: 1,
        purge: async ({ now, limit }) => {
          const result = await input.maintenance.run({
            now,
            maxItems: limit,
            remove: input.remove,
          });
          return result.acknowledged;
        },
      },
    ],
  });
  return startRetentionSweep({
    sweep,
    timers: input.timers,
    intervalMs,
    runOnStart: true,
  });
}
