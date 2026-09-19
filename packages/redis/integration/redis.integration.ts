import { expect, test } from 'bun:test';
import { createRedis } from '../src';
const url = process.env.TEST_REDIS_URL;
if (!url) throw new Error('TEST_REDIS_URL required');
test('ephemeral namespace roundtrip and cleanup', async () => {
  const redis = createRedis({ url, namespace: `test-${crypto.randomUUID()}` });
  try {
    expect(await redis.health()).toBe(true);
    await redis.setEphemeral('proof', 'value', 60);
    expect(await redis.get('proof')).toBe('value');
    await redis.delete('proof');
    expect(await redis.get('proof')).toBeNull();
  } finally {
    await redis.delete('proof');
    redis.close();
  }
});
