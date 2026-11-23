import type { Clock, Waits } from '@daisy/clock';
import {
  readRealtimeConfig,
  readRealtimeTransportConfig,
  readTrustedProxyConfig,
} from '@daisy/config';
import { WORKLOAD_PROFILES } from '@daisy/db/resources';
import { openRealtimeDatabase, type RealtimeDatabase } from './database';
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
  waits,
  database: injectedDatabase,
}: {
  /** Raw environment, validated here and nowhere else. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly clock: Clock;
  /** Injected time for the database's lane waits and every other bound (ADR 0915). */
  readonly waits: Waits;
  readonly database?: RealtimeDatabase;
}) {
  const config = readRealtimeConfig(env);
  const logger = createLogger({
    service: 'realtime',
    level: config.LOG_LEVEL,
    appVersion: config.APP_VERSION,
    gitCommit: config.GIT_COMMIT,
  });
  const transport = readRealtimeTransportConfig(env);
  // An eligible owner reserves the observation lanes; a fanout-only one does not.
  const database =
    injectedDatabase ??
    openRealtimeDatabase({
      url: config.DATABASE_URL,
      profile: transport.observationOwner
        ? WORKLOAD_PROFILES['realtime-observer']
        : WORKLOAD_PROFILES.realtime,
      eventSink: logger.log,
      waits,
    });
  const redis = createRedis({
    url: config.REDIS_URL,
    namespace: config.REDIS_NAMESPACE,
    eventSink: logger.log,
  });
  return {
    config,
    transport: {
      ...transport,
      trustedProxyEntries: readTrustedProxyConfig(env),
    },
    clock,
    waits,
    database,
    redis,
    logger,
    /** isDraining, drain, and close (drains, then closes both pools). */
    ...createDrainState([database, redis]),
  };
}
export type RealtimeApp = ReturnType<typeof createRealtimeApp>;
