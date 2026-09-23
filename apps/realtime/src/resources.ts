import { readRealtimeConfig } from '@daisy/config';
import { systemClock } from '@daisy/clock';
import { createDatabase } from '@daisy/db';
import { createRedis } from '@daisy/redis';
import { createLogger } from '@daisy/logger';

function createResources() {
  const config = readRealtimeConfig(process.env);
  const logger = createLogger({
    service: 'realtime',
    level: config.LOG_LEVEL,
    appVersion: config.APP_VERSION,
    gitCommit: config.GIT_COMMIT,
  });
  const database = createDatabase({
    url: config.DATABASE_URL,
    eventSink: (event, fields, message) => logger.log(event, fields, message),
  });
  const redis = createRedis({
    url: config.REDIS_URL,
    namespace: config.REDIS_NAMESPACE,
    eventSink: (event, fields, message) => logger.log(event, fields, message),
  });
  return {
    config,
    clock: systemClock,
    database,
    redis,
    logger,
    draining: false,
  };
}
export type RealtimeResources = ReturnType<typeof createResources>;
// The only process-local state is connection pools, logger and shutdown
// state, mirroring apps/web/src/server/resources.ts; realtime additionally
// holds open sockets, subscriptions and the drain cursor (RT-2.3b), all
// rebuilt on restart, never here.
const processState = globalThis as typeof globalThis & {
  daisyRealtimeResources?: RealtimeResources;
};
export function getResources(): RealtimeResources {
  return (processState.daisyRealtimeResources ??= createResources());
}
export async function closeResources() {
  const state = processState.daisyRealtimeResources;
  if (!state) return;
  state.draining = true;
  await Promise.allSettled([state.database.close(), state.redis.close()]);
}
