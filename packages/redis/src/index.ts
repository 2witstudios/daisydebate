import { RedisClient } from 'bun';
export type RedisConfig = { readonly url: string; readonly namespace: string };
export type RedisEventSink = (
  event: 'redis.command.failed',
  fields: Readonly<Record<string, unknown>>,
  message: string,
) => void;
export function redisKey(namespace: string, ...segments: string[]): string {
  if (
    ![namespace, ...segments].every((segment) =>
      /^[a-zA-Z0-9_-]{1,100}$/.test(segment),
    )
  )
    throw new Error('Invalid Redis key segment');
  return [namespace, 'v1', ...segments].join(':');
}
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
    close() {
      client.close();
    },
  };
}
