import { createBroadcastWorkerStore } from '@daisy/db/broadcast-worker';
import { createLogger } from '@daisy/logger';
import { stopAll } from '@daisy/worker';
import { hostWaits } from '@daisy/worker/host';
import { createId } from '@paralleldrive/cuid2';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWorkerConfig } from './config';
import { createObjects } from './objects';
import { startFeedWithdrawals } from './withdrawal';
import { startBroadcastSlot } from './worker';

/** Within Fly's 30 s grace: a slot stuck on a silent store is abandoned, not awaited. */
const DRAIN_MS = 20_000;

// The deployment edge: the real environment, clock, time and process signals.
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
const scratchDir = (broadcastId: string) =>
  join(tmpdir(), 'broadcast-worker', broadcastId);
const edges = {
  store,
  objects,
  now: Date.now,
  waits: hostWaits,
  report: (
    event:
      | 'broadcast.release_failed'
      | 'broadcast.withdrawal_failed'
      | 'broadcast.release_lapsed'
      | 'broadcast.clip_skipped',
  ) => logger.log(event, {}, 'Broadcast worker'),
};
const workers = [
  startFeedWithdrawals({ ...edges, owner: createId() }),
  ...Array.from({ length: config.BROADCAST_WORKER_SLOTS }, () =>
    startBroadcastSlot({
      ...edges,
      owner: createId(),
      scratch: {
        dir: scratchDir,
        clear: (id) => rm(scratchDir(id), { recursive: true, force: true }),
      },
    }),
  ),
];
const shutdown = async () => {
  const drain = await stopAll({
    waits: hostWaits,
    workers,
    deadlineMs: DRAIN_MS,
  });
  if (drain === 'overdue') process.exit(1);
  await store.close();
  process.exit(0);
};
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => void shutdown());
