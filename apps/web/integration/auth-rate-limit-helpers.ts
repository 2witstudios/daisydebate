import { systemClock, systemId } from '@daisy/clock';
import { readAuthConfig } from '@daisy/config';
import { createDatabase } from '@daisy/db';
import { createRedis } from '@daisy/redis';
import { testDatabaseUrl, testRedisUrl, type TestApp } from './fixtures';
import { createAuthRouteHandlers } from '../src/features/auth/handlers';
import { createAuthRateLimiter } from '../src/features/auth/redis-limiter';
import { createAuthServer } from '../src/features/auth/server';

const silentLogger = { log: () => {}, child: () => silentLogger };
const noLedger = { isSuppressed: async () => false, record: async () => {} };

export const statuses = (responses: Response[]) =>
  responses.reduce<Record<number, number>>((tally, response) => {
    tally[response.status] = (tally[response.status] ?? 0) + 1;
    return tally;
  }, {});

/**
 * Second application instances beside a suite's own app: each has its own
 * SQL pool, Redis connection and auth, sharing the suite's configuration
 * and Redis namespace (the shared limiter state under test).
 */
export function createSecondInstances(testApp: TestApp) {
  const extraInstances: Array<() => Promise<void>> = [];
  const secondInstance = (
    overrides: {
      redisUrl?: string;
      limiter?: (
        base: ReturnType<typeof createAuthRateLimiter>,
      ) => Parameters<typeof createAuthServer>[0]['limiter'];
    } = {},
  ) => {
    const database = createDatabase({
      url: testDatabaseUrl as string,
      nextActorId: () => systemId.next(),
    });
    const redis = createRedis({
      url: overrides.redisUrl ?? (testRedisUrl as string),
      namespace: testApp.redisNamespace,
    });
    const base = createAuthRateLimiter(redis);
    const sent: string[] = [];
    const server = createAuthServer({
      config: readAuthConfig(testApp.env),
      database: database.authAdapter,
      emailSender: {
        send: async (message) => {
          sent.push(message.to);
        },
      },
      limiter: overrides.limiter ? overrides.limiter(base) : base,
      ledger: noLedger,
      appendSessionRevoked: async () => {},
      revokeOtherSessions: async () => 0,
      completeEmailChange: (input) => database.completeEmailChange(input),
      revokeSessionUnlessAddressHeld: (input) =>
        database.revokeSessionUnlessAddressHeld(input),
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
      handlers: createAuthRouteHandlers(
        () => ({ handler: server.instance.handler, config: server.config }),
        silentLogger,
      ),
    };
  };
  const closeExtraInstances = async () => {
    for (const close of extraInstances.splice(0)) await close();
  };
  return { secondInstance, closeExtraInstances };
}
