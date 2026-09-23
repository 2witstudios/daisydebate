import { RedisClient } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { createRedis, redisKey } from '../src';
import { deleteNamespace } from '../src/namespaces';

/** A raw client for assertions our own package's API cannot make: PTTL, EXISTS, and direct key manipulation. */
async function rawClient(url: string) {
  const client = new RedisClient(url);
  await client.connect();
  return client;
}

/** Any past instant: PEXPIREAT to it makes Redis expire the key now. */
const PAST_MS = '1';

/**
 * One test's own Redis: a fresh namespace, the package client over it, a raw
 * client for direct assertions, and a key builder. Every key the namespace
 * holds is removed afterwards, so a test cleans exactly what it created.
 */
export async function withRedis<T>(
  url: string,
  work: (context: {
    readonly namespace: string;
    readonly redis: ReturnType<typeof createRedis>;
    readonly raw: RedisClient;
    readonly key: (...segments: string[]) => string;
    /** Fires a key's expiry now: the moment its TTL would have run out. */
    readonly expireNow: (key: string) => Promise<unknown>;
    /** The Redis server clock every lease score is written in. */
    readonly serverNowMs: () => Promise<number>;
  }) => Promise<T>,
): Promise<T> {
  const namespace = `test-${createId()}`;
  const redis = createRedis({ url, namespace });
  const raw = await rawClient(url);
  try {
    return await work({
      namespace,
      redis,
      raw,
      key: (...segments) => redisKey(namespace, ...segments),
      expireNow: (key) => raw.send('PEXPIREAT', [key, PAST_MS]),
      serverNowMs: async () => {
        const [seconds, micros] = (await raw.send('TIME', [])) as [
          string,
          string,
        ];
        return Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
      },
    });
  } finally {
    await deleteNamespace(raw, namespace);
    redis.close();
    raw.close();
  }
}
