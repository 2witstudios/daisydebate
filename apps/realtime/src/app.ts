import type { Clock, IdGenerator } from '@daisy/clock';
import { readRealtimeConfig } from '@daisy/config';
import { createDatabase } from '@daisy/db';
import { createLogger } from '@daisy/logger';
import { createDrainState } from '@daisy/observability';
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
    eventSink: logger.log,
    nextActorId: () => ids.next(),
  });
  const redis = createRedis({
    url: config.REDIS_URL,
    namespace: config.REDIS_NAMESPACE,
    eventSink: logger.log,
  });
  return {
    config,
    clock,
    database,
    redis,
    logger,
    /** isDraining, drain, and close (drains, then closes both pools). */
    ...createDrainState([database, redis]),
  };
}
export type RealtimeApp = ReturnType<typeof createRealtimeApp>;
