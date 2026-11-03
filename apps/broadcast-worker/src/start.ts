import {
  audienceStateKey,
  createAudiencePublisherStore,
} from '@daisy/db/audience-publisher';
import { createBroadcastWorkerStore } from '@daisy/db/broadcast-worker';
import { createLogger } from '@daisy/logger';
import { officialFeedPath } from '@daisy/protocol';
import { createRedis } from '@daisy/redis';
import { createId } from '@paralleldrive/cuid2';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAudienceStatePublisher,
  runAudienceStatePublisher,
} from './audience-state';
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
  report: (
    event:
      | 'broadcast.release_failed'
      | 'broadcast.withdrawal_failed'
      | 'broadcast.release_lapsed'
      | 'broadcast.clip_skipped'
      | 'audience.state_failed',
  ) => logger.log(event, {}, 'Broadcast worker'),
};
const publisherStore = createAudiencePublisherStore(
  config.AUDIENCE_PUBLISHER_DATABASE_URL,
);
const publisher = createAudienceStatePublisher({
  store: publisherStore,
  objects,
  counts: createRedis({
    url: config.REDIS_URL,
    namespace: config.REDIS_NAMESPACE,
  }),
  keyOf: audienceStateKey,
  feedUrlOf: (feedKey) =>
    new URL(officialFeedPath(feedKey), config.BROADCAST_PUBLIC_ORIGIN).href,
  now: edges.now,
  report: edges.report,
});
await Promise.all([
  runAudienceStatePublisher({
    publisher,
    now: edges.now,
    sleep: edges.sleep,
    stopped: edges.stopped,
    report: edges.report,
  }),
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
await publisherStore.close();
await store.close();
