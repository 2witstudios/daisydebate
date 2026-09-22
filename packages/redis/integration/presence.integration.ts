import { expect, test } from 'bun:test';
import { createRedis, redisKey } from '../src';
import { rawClient } from './test-support';
const url = process.env.TEST_REDIS_URL;
if (!url) throw new Error('TEST_REDIS_URL required');

/** Every score is server time, so a client-side check tolerates script/network latency, never exact equality. */
function expectExpiryNear(
  actual: number,
  ttlSeconds: number,
  toleranceMs = 5_000,
) {
  const now = Date.now();
  expect(actual).toBeGreaterThan(now + ttlSeconds * 1000 - toleranceMs);
  expect(actual).toBeLessThanOrEqual(now + ttlSeconds * 1000 + toleranceMs);
}

test('presence lease upsert, refresh and delete are visible through the reads', async () => {
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  const actorId = 'actorA';
  try {
    await redis.upsertPresenceLease(
      { connId: 'connA1', actorId, instanceId: 'instX', activity: 'active' },
      60,
    );
    // A second connection from the same actor is scored independently.
    await redis.upsertPresenceLease(
      { connId: 'connA2', actorId, instanceId: 'instY', activity: 'idle' },
      120,
    );
    const afterUpsert = await redis.readActorConnections(actorId);
    expect(afterUpsert.length).toBe(2);
    expect(afterUpsert.map((c) => c.connId).sort()).toEqual([
      'connA1',
      'connA2',
    ]);
    const conn1 = afterUpsert.find((c) => c.connId === 'connA1');
    expect(conn1?.activity).toBe('active');
    expect(conn1?.instanceId).toBe('instX');
    expectExpiryNear(conn1!.expiresAtMs, 60);
    // Online set is scored by the actor's LATEST lease expiry (connA2's 120s), not the first upsert.
    const onlineAfterUpsert = await redis.readOnlinePresence();
    expect(onlineAfterUpsert.length).toBe(1);
    expect(onlineAfterUpsert[0]!.actorId).toBe(actorId);
    expectExpiryNear(onlineAfterUpsert[0]!.expiresAtMs, 120);

    const refreshed = await redis.refreshPresenceLease(
      { connId: 'connA1', actorId },
      90,
    );
    expect(refreshed).toEqual({ refreshed: true });
    const afterRefresh = await redis.readActorConnections(actorId);
    expectExpiryNear(
      afterRefresh.find((c) => c.connId === 'connA1')!.expiresAtMs,
      90,
    );

    await redis.deletePresenceLease({ connId: 'connA2', actorId });
    const afterDelete = await redis.readActorConnections(actorId);
    expect(afterDelete.map((c) => c.connId)).toEqual(['connA1']);
    // Online score falls back to the one remaining connection's expiry.
    const onlineAfterDelete = await redis.readOnlinePresence();
    expect(onlineAfterDelete.length).toBe(1);
    expectExpiryNear(onlineAfterDelete[0]!.expiresAtMs, 90);

    await redis.deletePresenceLease({ connId: 'connA1', actorId });
    expect(await redis.readActorConnections(actorId)).toEqual([]);
    // No connections remain, so the actor drops out of the online set entirely.
    expect(await redis.readOnlinePresence()).toEqual([]);
  } finally {
    await redis.deletePresenceLease({ connId: 'connA1', actorId });
    await redis.deletePresenceLease({ connId: 'connA2', actorId });
    redis.close();
  }
});

test('the actor and online zsets carry a mandatory expiry covering the longest live lease, never PTTL -1', async () => {
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  const raw = await rawClient(url);
  const actorId = 'ttlBearingActor';
  try {
    await redis.upsertPresenceLease(
      { connId: 'connX', actorId, instanceId: 'inst1', activity: 'active' },
      60,
    );
    const connPttl = await raw.pttl(
      redisKey(namespace, 'presence', 'conn', 'connX'),
    );
    const actorPttl = await raw.pttl(
      redisKey(namespace, 'presence', 'actor', actorId),
    );
    const onlinePttl = await raw.pttl(
      redisKey(namespace, 'presence', 'online'),
    );
    // All three keys must carry an expiry; -1 means "no TTL" (unbounded growth).
    expect(connPttl).toBeGreaterThan(0);
    expect(actorPttl).toBeGreaterThan(0);
    expect(onlinePttl).toBeGreaterThan(0);
    expect(connPttl).toBeLessThanOrEqual(60_000);
    expect(actorPttl).toBeLessThanOrEqual(60_000);
    expect(onlinePttl).toBeLessThanOrEqual(60_000);
  } finally {
    await redis.deletePresenceLease({ connId: 'connX', actorId });
    redis.close();
    raw.close();
  }
});

test('refreshing with a longer TTL extends an existing zset expiry (PEXPIRE ... GT), not just arms it once', async () => {
  // The mandatory-expiry test above only proves a TTL gets set at all
  // (which PEXPIRE ... NX alone would also do). This proves GT actually
  // extends it: without GT, a second PEXPIRE against an already-TTL'd key
  // is a no-op, so the actor zset's expiry would still reflect the first
  // (shorter) write and this would fail.
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  const raw = await rawClient(url);
  const actorId = 'gtExtendedActor';
  try {
    await redis.upsertPresenceLease(
      { connId: 'connG', actorId, instanceId: 'inst1', activity: 'active' },
      5,
    );
    await redis.refreshPresenceLease({ connId: 'connG', actorId }, 100);
    const actorPttl = await raw.pttl(
      redisKey(namespace, 'presence', 'actor', actorId),
    );
    expect(actorPttl).toBeGreaterThan(5_000);
  } finally {
    await redis.deletePresenceLease({ connId: 'connG', actorId });
    redis.close();
    raw.close();
  }
});

test('a delete arms a fresh expiry when it recreates a dropped online zset from a genuinely live remaining connection', async () => {
  // Distinct from the "never recreates from a stale leftover" test: here
  // the remaining connection is still perfectly live. The online zset key
  // is dropped directly (simulating an earlier read's trim), and deleting
  // the OTHER connection must still leave the recreated online key with a
  // bounded expiry, not PTTL -1.
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  const raw = await rawClient(url);
  const actorId = 'recreatedOnlineActor';
  const onlineKey = redisKey(namespace, 'presence', 'online');
  try {
    await redis.upsertPresenceLease(
      { connId: 'staying', actorId, instanceId: 'inst1', activity: 'active' },
      100,
    );
    await redis.upsertPresenceLease(
      { connId: 'leaving', actorId, instanceId: 'inst2', activity: 'active' },
      100,
    );
    // Simulate the online zset having already been dropped.
    await raw.del(onlineKey);

    await redis.deletePresenceLease({ connId: 'leaving', actorId });

    // "staying" is still live, so the actor must be back online — with a
    // real expiry on the recreated key, never PTTL -1.
    const online = await redis.readOnlinePresence();
    expect(online.map((a) => a.actorId)).toEqual([actorId]);
    expect(await raw.pttl(onlineKey)).toBeGreaterThan(0);
  } finally {
    await redis.deletePresenceLease({ connId: 'staying', actorId });
    await redis.deletePresenceLease({ connId: 'leaving', actorId });
    redis.close();
    raw.close();
  }
});

test('the online score always reflects the actor’s longest live lease, not the most recently upserted one', async () => {
  // Negative control for a real mutation a reviewer found: scoring the
  // online set by the just-upserted lease instead of the actor zset's top
  // would pass every other test here because they always upsert the
  // longest lease last. This one upserts the longer lease FIRST.
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  const actorId = 'longThenShortActor';
  try {
    await redis.upsertPresenceLease(
      { connId: 'longConn', actorId, instanceId: 'inst1', activity: 'active' },
      120,
    );
    await redis.upsertPresenceLease(
      { connId: 'shortConn', actorId, instanceId: 'inst2', activity: 'active' },
      5,
    );
    const online = await redis.readOnlinePresence();
    expect(online.length).toBe(1);
    // Must still reflect the 120s lease, not the 5s one just written.
    expectExpiryNear(online[0]!.expiresAtMs, 120);
  } finally {
    await redis.deletePresenceLease({ connId: 'longConn', actorId });
    await redis.deletePresenceLease({ connId: 'shortConn', actorId });
    redis.close();
  }
});
