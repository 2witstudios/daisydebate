import { repeatEvery } from '@daisy/worker';
import type { Waits } from '@daisy/clock';
import type { Clock } from '@daisy/clock';
import type { createDatabase } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import { createScheduledWorker } from '../features/ops/scheduled-worker';

/** Explicit reservation expiry/deletion cadence; no collection or retention approval is inferred. */
export function startMessagingFileMaintenance(input: {
  readonly maintenance: ReturnType<
    typeof createDatabase
  >['messagingFileMaintenance'];
  readonly config: { readonly intervalMs: number; readonly maxItems: number };
  readonly remove: (key: string) => Promise<void>;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly waits: Waits;
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
  const work = createScheduledWorker({
    name: 'messaging_file_maintenance',
    clock: input.clock,
    logger: input.logger,
    // A vendor refusal throws out of `run`, and the next run retries without
    // backoff. A full batch may have left more behind, so it still owes.
    pass: async (now) => {
      const { acknowledged } = await input.maintenance.run({
        now,
        maxItems,
        remove: input.remove,
      });
      return {
        deleted: acknowledged,
        retried: 0,
        owed: acknowledged >= maxItems ? 1 : 0,
      };
    },
  });
  return repeatEvery({
    run: () => work.run(),
    waits: input.waits,
    everyMs: intervalMs,
    runOnStart: true,
    // Each run reports its own failure.
    failed: () => undefined,
  });
}
