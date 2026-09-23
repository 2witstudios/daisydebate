import type { Clock, IdGenerator } from '@daisy/clock';
import { readRealtimeConfig } from '@daisy/config';
import { createDatabase } from '@daisy/db';
import { createLogger } from '@daisy/logger';
import { createRedis } from '@daisy/redis';

/**
 * The realtime composition root, mirroring apps/web's `createApp`: one call
 * validates config and builds the logger, database and Redis from explicit
 * dependencies, reading no ambient state. `start.ts`, the process edge,
 * builds the one the server runs. Open sockets, subscriptions and the drain
 * cursor (RT-2.3b) are rebuilt on restart, never kept here.
 */
export function createRealtimeApp({
  env,
  clock,
  ids,
}: {
  /** Raw environment, validated here and nowhere else. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}) {
  const config = readRealtimeConfig(env);
  const logger = createLogger({
    service: 'realtime',
    level: config.LOG_LEVEL,
    appVersion: config.APP_VERSION,
    gitCommit: config.GIT_COMMIT,
  });
  const database = createDatabase({
    url: config.DATABASE_URL,
    eventSink: (event, fields, message) => logger.log(event, fields, message),
    nextActorId: () => ids.next(),
  });
  const redis = createRedis({
    url: config.REDIS_URL,
    namespace: config.REDIS_NAMESPACE,
    eventSink: (event, fields, message) => logger.log(event, fields, message),
  });
  const app = {
    config,
    clock,
    database,
    redis,
    logger,
    /** Readiness reports unavailable once shutdown begins. */
    draining: false,
    /** Drains, then closes the pools; never rejects. */
    close: async () => {
      app.draining = true;
      await Promise.allSettled([database.close(), redis.close()]);
    },
  };
  return app;
}

export type RealtimeApp = ReturnType<typeof createRealtimeApp>;
