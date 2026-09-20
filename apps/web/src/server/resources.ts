import { readServerConfig } from '@daisy/config';
import { systemClock, systemId } from '@daisy/clock';
import { createDatabase } from '@daisy/db';
import { createRedis } from '@daisy/redis';
import { createLogger } from '@daisy/logger';

function createResources() {
  const config = readServerConfig(process.env);
  const logger = createLogger({
    service: 'web',
    level: config.LOG_LEVEL,
    appVersion: config.APP_VERSION,
    gitCommit: config.GIT_COMMIT,
  });
  return {
    config,
    clock: systemClock,
    ids: systemId,
    database: createDatabase({
      url: config.DATABASE_URL,
      eventSink: (event, fields, message) => logger.log(event, fields, message),
    }),
    redis: createRedis({
      url: config.REDIS_URL,
      namespace: config.REDIS_NAMESPACE,
      eventSink: (event, fields, message) => logger.log(event, fields, message),
    }),
    logger,
    draining: false,
  };
}
type Resources = ReturnType<typeof createResources>;
// The only process-local state is connection pools, logger and shutdown state.
// Share it across Next bundles and development reloads, never store product data here.
const processState = globalThis as typeof globalThis & {
  daisyResources?: Resources;
};
export function getResources(): Resources {
  return (processState.daisyResources ??= createResources());
}
export async function closeResources() {
  const state = processState.daisyResources;
  if (!state) return;
  state.draining = true;
  await Promise.allSettled([state.database.close(), state.redis.close()]);
}
