import { createBroadcastWorkerStore } from '@daisy/db/broadcast-worker';
import { createLogger } from '@daisy/logger';
import { createId } from '@paralleldrive/cuid2';
import { readWorkerConfig } from './config';
import { createObjects } from './objects';
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
await Promise.all(
  Array.from({ length: config.BROADCAST_WORKER_SLOTS }, () =>
    runWorker({
      owner: createId(),
      store,
      objects,
      now: Date.now,
      sleep: Bun.sleep,
      stopped: () => stopping,
      report: (event) => logger.log(event, {}, 'Broadcast worker failure'),
    }),
  ),
);
await store.close();
