import { systemClock, systemId } from '@daisy/clock';
import { createDatabase } from '@daisy/db';
import { createRedis } from '@daisy/redis';
import {
  redisNamespace,
  testDatabaseUrl,
  testRedisUrl,
} from './auth-mounted-helpers';
import { createAuthRouteHandlers } from '../src/features/auth/handlers';
import { createAuthRateLimiter } from '../src/features/auth/redis-limiter';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';
import { createAuthServer } from '../src/features/auth/server';

const silentLogger = { log: () => {}, child: () => silentLogger };
const noLedger = { isSuppressed: async () => false, record: async () => {} };

export const statuses = (responses: Response[]) =>
  responses.reduce<Record<number, number>>((tally, response) => {
    tally[response.status] = (tally[response.status] ?? 0) + 1;
    return tally;
  }, {});

const extraInstances: Array<() => Promise<void>> = [];
export const closeExtraInstances = async () => {
  for (const close of extraInstances.splice(0)) await close();
};

/** A second application instance: its own SQL pool, Redis connection and auth. */
export function secondInstance(
  overrides: {
    redisUrl?: string;
    limiter?: (
      base: ReturnType<typeof createAuthRateLimiter>,
    ) => Parameters<typeof createAuthServer>[0]['limiter'];
  } = {},
) {
  const database = createDatabase({ url: testDatabaseUrl as string });
  const redis = createRedis({
    url: overrides.redisUrl ?? (testRedisUrl as string),
    namespace: redisNamespace,
  });
  const base = createAuthRateLimiter(redis);
  const sent: string[] = [];
  const server = createAuthServer({
    env: process.env as Record<string, string | undefined>,
    database: database.authAdapter,
    emailSender: {
      send: async (message) => {
        sent.push(message.to);
      },
    },
    limiter: overrides.limiter ? overrides.limiter(base) : base,
    clientIp: { trustedHeaders: [CLIENT_IP_HEADER] },
    ledger: noLedger,
    logger: silentLogger,
    clock: systemClock,
    ids: systemId,
  });
  extraInstances.push(async () => {
    await database.close();
    redis.close();
  });
  return {
    sent,
    handlers: createAuthRouteHandlers(() => ({
      handler: server.instance.handler,
      config: server.config,
    })),
  };
}
