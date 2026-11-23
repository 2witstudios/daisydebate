import {
  audienceStateKey,
  createAudiencePublisherStore,
} from '@daisy/db/audience-publisher';
import { createLogger } from '@daisy/logger';
import { officialFeedPath } from '@daisy/protocol/official-feed';
import { createRedis } from '@daisy/redis';
import { stopAll } from '@daisy/worker';
import { hostWaits } from '@daisy/worker/host';
import {
  createAudienceStatePublisher,
  startAudienceStatePublisher,
  type AudienceStateFailure,
} from './audience-state';
import { readPublisherConfig } from './config';
import { createPublicObjects } from './objects';

/** Within Fly's 30 s grace: a pass stuck on a silent store is abandoned, not awaited. */
const DRAIN_MS = 10_000;

// The deployment edge: the real environment, clock, time and process signals.
const config = readPublisherConfig(process.env);
const store = createAudiencePublisherStore(
  config.AUDIENCE_PUBLISHER_DATABASE_URL,
);
const logger = createLogger({ service: 'audience-publisher' });
const report = (failure: AudienceStateFailure) =>
  logger.log('audience.state_failed', failure, 'Audience publisher');
const publisher = startAudienceStatePublisher({
  publisher: createAudienceStatePublisher({
    store,
    objects: createPublicObjects({
      endpoint: config.BROADCAST_STORAGE_ENDPOINT,
      bucket: config.BROADCAST_PUBLIC_BUCKET,
      key: config.BROADCAST_PUBLIC_KEY,
      secret: config.BROADCAST_PUBLIC_SECRET,
      waits: hostWaits,
    }),
    counts: createRedis({
      url: config.REDIS_URL,
      namespace: config.REDIS_NAMESPACE,
    }),
    keyOf: audienceStateKey,
    feedUrlOf: (feedKey) =>
      new URL(officialFeedPath(feedKey), config.BROADCAST_PUBLIC_ORIGIN).href,
    now: Date.now,
    report,
  }),
  waits: hostWaits,
  report,
});
const shutdown = async () => {
  const drain = await stopAll({
    waits: hostWaits,
    workers: [publisher],
    deadlineMs: DRAIN_MS,
  });
  if (drain === 'overdue') process.exit(1);
  await store.close();
  process.exit(0);
};
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => void shutdown());
