import { repeatEvery } from '@daisy/worker';
import type { Waits } from '@daisy/clock';
import { instantMs } from '@daisy/clock';
import type { Clock } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import { runDeletionSweep } from '../features/recording/deletion-sweep';
import type {
  RecordingObjectStore,
  RecordingStore,
} from '../features/recording/ports';
import { createRetentionSweep } from './retention-sweep';

const RECORDING_DELETION_INTERVAL_MS = 60_000;

/**
 * Carries out durable Recording deletion intents: a removal, an account's
 * erasure or an old failed capture. Runs here so a dead process or a storage
 * outage only delays it; the intent stays until the objects are gone.
 */
export function startRecordingDeletions(input: {
  readonly store: RecordingStore;
  readonly objects: RecordingObjectStore;
  readonly owner: string;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly waits: Waits;
  readonly intervalMs?: number;
}) {
  const sweep = createRetentionSweep({
    clock: input.clock,
    logger: input.logger,
    targets: [
      {
        name: 'retention.recording_deletions',
        batchSize: 1,
        maxBatches: 1,
        purge: async ({ now }) => {
          const result = await runDeletionSweep({
            store: input.store,
            objects: input.objects,
            owner: input.owner,
            nowMs: instantMs(now),
            report: (event) =>
              input.logger.log(event, {}, 'Recording deletion'),
          });
          return result.removedRecordings;
        },
      },
    ],
  });
  const work = sweep;
  return repeatEvery({
    run: (signal) => work.run(signal),
    waits: input.waits,
    everyMs: input.intervalMs ?? RECORDING_DELETION_INTERVAL_MS,
    runOnStart: false,
    // Each run reports its own failure.
    failed: () => undefined,
  });
}
