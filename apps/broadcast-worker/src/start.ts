import { createBroadcastWorkerStore } from '@daisy/db/broadcast-worker';
import { createLogger } from '@daisy/logger';
import { createId } from '@paralleldrive/cuid2';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWorkerConfig } from './config';
import { createObjects } from './objects';
import { runFeedWithdrawals } from './withdrawal';
import { runWorker } from './worker';

// The deployment edge: the real environment, clock and process signals.
const config = readWorkerConfig(process.env);
const store = createBroadcastWorkerStore(config.BROADCAST_WORKER_DATABASE_URL);
const objects = createObjects({
  endpoint: config.BROADCAST_STORAGE_ENDPOINT,
  hold: {
    bucket: config.BROADCAST_HOLD_BUCKET,
    key: config.BROADCAST_HOLD_KEY,
    secret: config.BROADCAST_HOLD_SECRET,
  },
  public: {
    bucket: config.BROADCAST_PUBLIC_BUCKET,
    key: config.BROADCAST_PUBLIC_KEY,
    secret: config.BROADCAST_PUBLIC_SECRET,
  },
});
const logger = createLogger({ service: 'broadcast-worker' });
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    stopping = true;
  });
const scratchDir = (broadcastId: string) =>
  join(tmpdir(), 'broadcast-worker', broadcastId);
const edges = {
  store,
  objects,
  now: Date.now,
  sleep: Bun.sleep,
  stopped: () => stopping,
  report: (event: 'broadcast.release_failed' | 'broadcast.withdrawal_failed') =>
    logger.log(event, {}, 'Broadcast worker failure'),
};
await Promise.all([
  runFeedWithdrawals({ ...edges, owner: createId() }),
  ...Array.from({ length: config.BROADCAST_WORKER_SLOTS }, () =>
    runWorker({
      ...edges,
      owner: createId(),
      scratch: {
        dir: scratchDir,
        clear: (id) => rm(scratchDir(id), { recursive: true, force: true }),
      },
    }),
  ),
]);
await store.close();
