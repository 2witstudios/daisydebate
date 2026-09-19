import { RedisClient } from 'bun';
export type RedisConfig = { readonly url: string; readonly namespace: string };
export function redisKey(namespace: string, ...segments: string[]): string {
  if (
    ![namespace, ...segments].every((segment) =>
      /^[a-zA-Z0-9_-]{1,100}$/.test(segment),
    )
  )
    throw new Error('Invalid Redis key segment');
  return [namespace, 'v1', ...segments].join(':');
}
export function createRedis({ url, namespace }: RedisConfig) {
  redisKey(namespace);
  const client = new RedisClient(url, {
    connectionTimeout: 2000,
    enableOfflineQueue: false,
    maxRetries: 2,
  });
  return {
    async health() {
      await client.connect();
      return (await client.ping()) === 'PONG';
    },
    async setEphemeral(key: string, value: string, ttlSeconds: number) {
      if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1)
        throw new Error('TTL must be a positive integer');
      await client.connect();
      await client.send('SET', [
        redisKey(namespace, key),
        value,
        'EX',
        String(ttlSeconds),
      ]);
    },
    async get(key: string) {
      await client.connect();
      return client.get(redisKey(namespace, key));
    },
    async delete(key: string) {
      await client.connect();
      await client.del(redisKey(namespace, key));
    },
    close() {
      client.close();
    },
  };
}
