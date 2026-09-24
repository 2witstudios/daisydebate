import { RedisClient } from 'bun';
import { createPresenceOperations } from './presence';
import { createTicketOperations } from './ticket';
import { redisKey } from './redis-key';
export { redisKey } from './redis-key';
export type RedisConfig = { readonly url: string; readonly namespace: string };
export type RedisEventSink = (
  event: 'redis.command.failed',
  fields: Readonly<Record<string, unknown>>,
  message: string,
) => void;
/**
 * Fixed-window counter in ONE atomic script: increment, arm the expiry on the
 * first hit (or if it is somehow missing), and decide. Denied attempts keep
 * counting, so the decision never depends on read-modify-write across calls.
 * KEYS[1] key; ARGV[1] window ms; ARGV[2] max. Returns {allowed, ttlMs}.
 */
const consumeScript = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
if count > tonumber(ARGV[2]) then return {0, ttl} end
return {1, ttl}
`;
export type RateLimitRule = {
  readonly windowSeconds: number;
  readonly max: number;
};
export function createRedis({
  url,
  namespace,
  eventSink,
  client: injectedClient,
}: RedisConfig & {
  readonly eventSink?: RedisEventSink;
  /** Overrides dialing `url`; tests inject a scripted client at this seam. */
  readonly client?: RedisClient;
}) {
  redisKey(namespace);
  const client =
    injectedClient ??
    new RedisClient(url, {
      connectionTimeout: 2000,
      enableOfflineQueue: false,
      maxRetries: 2,
    });
  const reportFailure = (operation: string) =>
    eventSink?.('redis.command.failed', { operation }, 'Redis command failed');
  return {
    async health() {
      try {
        await client.connect();
        return (await client.ping()) === 'PONG';
      } catch (error) {
        reportFailure('health');
        throw error;
      }
    },
    async setEphemeral(key: string, value: string, ttlSeconds: number) {
      if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1)
        throw new Error('TTL must be a positive integer');
      try {
        await client.connect();
        await client.send('SET', [
          redisKey(namespace, key),
          value,
          'EX',
          String(ttlSeconds),
        ]);
      } catch (error) {
        reportFailure('setEphemeral');
        throw error;
      }
    },
    /** Atomic across instances; throws on outage so callers must fail closed. */
    async consumeRateLimit(key: string, rule: RateLimitRule) {
      if (
        !Number.isSafeInteger(rule.windowSeconds) ||
        rule.windowSeconds < 1 ||
        !Number.isSafeInteger(rule.max) ||
        rule.max < 1
      )
        throw new Error('Invalid rate limit rule');
      const namespaced = redisKey(namespace, 'rl', key);
      try {
        await client.connect();
        const [allowed, ttlMs] = (await client.send('EVAL', [
          consumeScript,
          '1',
          namespaced,
          String(rule.windowSeconds * 1000),
          String(rule.max),
        ])) as [number, number];
        return {
          allowed: allowed === 1,
          retryAfterSeconds: allowed === 1 ? 0 : Math.ceil(ttlMs / 1000),
        };
      } catch (error) {
        reportFailure('consumeRateLimit');
        throw error;
      }
    },
    async get(key: string) {
      try {
        await client.connect();
        return await client.get(redisKey(namespace, key));
      } catch (error) {
        reportFailure('get');
        throw error;
      }
    },
    async delete(key: string) {
      try {
        await client.connect();
        await client.del(redisKey(namespace, key));
      } catch (error) {
        reportFailure('delete');
        throw error;
      }
    },
    ...createPresenceOperations({ client, namespace, reportFailure }),
    ...createTicketOperations({ client, namespace, reportFailure }),
    close() {
      client.close();
    },
  };
}
