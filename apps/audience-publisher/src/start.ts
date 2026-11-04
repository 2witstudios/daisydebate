import {
  audienceStateKey,
  createAudiencePublisherStore,
} from '@daisy/db/audience-publisher';
import { createLogger } from '@daisy/logger';
import { officialFeedPath } from '@daisy/protocol';
import { createRedis } from '@daisy/redis';
import {
  createAudienceStatePublisher,
  runAudienceStatePublisher,
  type AudienceStateFailure,
} from './audience-state';
import { readPublisherConfig } from './config';
import { createPublicObjects } from './objects';

// The deployment edge: the real environment, clock and process signals.
const config = readPublisherConfig(process.env);
const store = createAudiencePublisherStore(
  config.AUDIENCE_PUBLISHER_DATABASE_URL,
);
const logger = createLogger({ service: 'audience-publisher' });
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    stopping = true;
  });
const report = (failure: AudienceStateFailure) =>
  logger.log('audience.state_failed', failure, 'Audience publisher');
await runAudienceStatePublisher({
  publisher: createAudienceStatePublisher({
    store,
    objects: createPublicObjects({
      endpoint: config.BROADCAST_STORAGE_ENDPOINT,
      bucket: config.BROADCAST_PUBLIC_BUCKET,
      key: config.BROADCAST_PUBLIC_KEY,
      secret: config.BROADCAST_PUBLIC_SECRET,
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
  now: Date.now,
  sleep: Bun.sleep,
  stopped: () => stopping,
  report,
});
await store.close();
