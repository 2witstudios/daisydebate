import { expect, test } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { createRedis } from '../src';
const url = process.env.TEST_REDIS_URL;
if (!url) throw new Error('TEST_REDIS_URL required');

test('ephemeral namespace roundtrip and cleanup', async () => {
  const redis = createRedis({ url, namespace: `test-${createId()}` });
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
test('rate limit admits exactly max across concurrent instances and expires atomically', async () => {
  const namespace = `test-${createId()}`;
  // Two clients stand in for two application instances sharing one Redis.
  const instances = [
    createRedis({ url, namespace }),
    createRedis({ url, namespace }),
  ];
  const rule = { windowSeconds: 2, max: 7 };
  try {
    const decisions = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        instances[index % 2]!.consumeRateLimit('concurrent', rule),
      ),
    );
    const allowed = decisions.filter((decision) => decision.allowed).length;
    const retry = decisions.find((decision) => !decision.allowed);
    expect(allowed).toBe(7);
    expect(retry?.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(retry?.retryAfterSeconds).toBeLessThanOrEqual(2);
    // The key must carry an expiry (never a permanent counter).
    const ttl = await instances[0]!.consumeRateLimit('other-key', rule);
    expect(ttl.allowed).toBe(true);
    // Once the window has elapsed the same key admits again.
    await Bun.sleep(2100);
    const after = await instances[1]!.consumeRateLimit('concurrent', rule);
    expect(after.allowed).toBe(true);
  } finally {
    for (const instance of instances) instance.close();
  }
});

test('rate limit reports outage as a thrown error, never an allow', async () => {
  const dead = createRedis({
    url: 'redis://127.0.0.1:1',
    namespace: 'test-outage',
  });
  try {
    await expect(
      dead.consumeRateLimit('k', { windowSeconds: 60, max: 3 }),
    ).rejects.toThrow();
  } finally {
    dead.close();
  }
});
