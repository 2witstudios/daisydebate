import { RedisClient } from 'bun';
import { expect, test } from 'bun:test';
import { createRedis, redisKey } from '../src';
const url = process.env.TEST_REDIS_URL;
if (!url) throw new Error('TEST_REDIS_URL required');

/** A raw client for assertions our own package's API cannot make: PTTL, EXISTS, and direct key manipulation. */
async function rawClient() {
  const client = new RedisClient(url);
  await client.connect();
  return client;
}
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
  const raw = await rawClient();
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

test('an instance crash lets each of its connection leases expire on its own, over real (short) TTLs', async () => {
  // Simulates one instance holding three sockets for the same actor that
  // crashes without deleting any of them: only the passage of real time
  // (bounded by the TTLs themselves, no sleep-and-hope beyond that) trims
  // the stale leases. Scores and trims come from Redis TIME inside the
  // script (ADR 0033), so there is no client clock left to inject.
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  const actorId = 'crashedActor';
  try {
    await redis.upsertPresenceLease(
      {
        connId: 'shortLease',
        actorId,
        instanceId: 'deadInstance',
        activity: 'active',
      },
      2,
    );
    await redis.upsertPresenceLease(
      {
        connId: 'midLease',
        actorId,
        instanceId: 'deadInstance',
        activity: 'active',
      },
      4,
    );
    await redis.upsertPresenceLease(
      {
        connId: 'longLease',
        actorId,
        instanceId: 'deadInstance',
        activity: 'idle',
      },
      100,
    );

    // All three are alive right after the crash.
    expect(
      (await redis.readActorConnections(actorId)).map((c) => c.connId).sort(),
    ).toEqual(['longLease', 'midLease', 'shortLease']);
    expect((await redis.readOnlinePresence()).map((a) => a.actorId)).toEqual([
      actorId,
    ]);

    // ~2.5s later: only the 2s lease has expired.
    await Bun.sleep(2_500);
    const afterShort = await redis.readActorConnections(actorId);
    expect(afterShort.map((c) => c.connId).sort()).toEqual([
      'longLease',
      'midLease',
    ]);
    // The online score still reflects the longest-lived remaining lease.
    expectExpiryNear((await redis.readOnlinePresence())[0]!.expiresAtMs, 100);

    // ~2s more (4.5s total): the 4s lease has also expired, one by one.
    await Bun.sleep(2_000);
    const afterMid = await redis.readActorConnections(actorId);
    expect(afterMid.map((c) => c.connId)).toEqual(['longLease']);
  } finally {
    await redis.deletePresenceLease({ connId: 'shortLease', actorId });
    await redis.deletePresenceLease({ connId: 'midLease', actorId });
    await redis.deletePresenceLease({ connId: 'longLease', actorId });
    redis.close();
  }
}, 20_000);

test('a lease is a real Redis TTL: the hash physically disappears without a delete', async () => {
  // Proves the mandatory TTL is a genuine server-side expiry, not only our
  // own read trim. Checked directly against Redis with a raw client, so
  // removing the PEXPIRE in the write script would fail this test.
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  const raw = await rawClient();
  const actorId = 'ttlActor';
  const connKey = redisKey(namespace, 'presence', 'conn', 'ttlConn');
  try {
    await redis.upsertPresenceLease(
      { connId: 'ttlConn', actorId, instanceId: 'inst1', activity: 'active' },
      1,
    );
    expect(await raw.exists(connKey)).toBe(true);
    expect(
      (await redis.readActorConnections(actorId)).map((c) => c.connId),
    ).toEqual(['ttlConn']);

    await Bun.sleep(1_300);

    // Independent of our own read/trim logic: the hash is simply gone.
    expect(await raw.exists(connKey)).toBe(false);
    expect(await redis.readActorConnections(actorId)).toEqual([]);
  } finally {
    await redis.deletePresenceLease({ connId: 'ttlConn', actorId });
    redis.close();
    raw.close();
  }
}, 10_000);

test('refresh on an already-expired lease reports refreshed: false rather than reviving it', async () => {
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  const actorId = 'staleActor';
  try {
    await redis.upsertPresenceLease(
      { connId: 'staleConn', actorId, instanceId: 'inst1', activity: 'active' },
      1,
    );
    await Bun.sleep(1_300);

    const result = await redis.refreshPresenceLease(
      { connId: 'staleConn', actorId },
      60,
    );
    expect(result).toEqual({ refreshed: false });
    // Negative control: refresh must not have resurrected the hash or its TTL.
    expect(await redis.readActorConnections(actorId)).toEqual([]);
  } finally {
    await redis.deletePresenceLease({ connId: 'staleConn', actorId });
    redis.close();
  }
}, 10_000);

test('readActorConnections drops a record whose hash names a different actor than requested', async () => {
  // The zset is scoped per actor and server-minted cuid2 connIds make this
  // unlikely in practice, but the read must not trust the zset alone: it
  // checks the hydrated hash's own actorId field before returning a record.
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  const raw = await rawClient();
  try {
    // A real lease that legitimately belongs to actor p2.
    await redis.upsertPresenceLease(
      {
        connId: 'shared',
        actorId: 'p2',
        instanceId: 'inst1',
        activity: 'active',
      },
      60,
    );
    // Directly (bypassing our API) score that same connId into p1's actor
    // zset too, simulating a stale or corrupted cross-reference.
    await raw.send('ZADD', [
      redisKey(namespace, 'presence', 'actor', 'p1'),
      String(Date.now() + 60_000),
      'shared',
    ]);

    const p1Connections = await redis.readActorConnections('p1');
    expect(p1Connections).toEqual([]);
    // p2's own read is unaffected.
    const p2Connections = await redis.readActorConnections('p2');
    expect(p2Connections.map((c) => c.connId)).toEqual(['shared']);
  } finally {
    await redis.deletePresenceLease({ connId: 'shared', actorId: 'p2' });
    await raw.del(redisKey(namespace, 'presence', 'actor', 'p1'));
    redis.close();
    raw.close();
  }
});

test('presence reads and writes reject invalid ids, activity and TTLs before touching Redis', async () => {
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  try {
    await expect(redis.readActorConnections('not a valid id!')).rejects.toThrow(
      'Invalid actorId',
    );
    await expect(
      redis.upsertPresenceLease(
        { connId: 'ok', actorId: 'ok', instanceId: 'ok', activity: 'active' },
        0,
      ),
    ).rejects.toThrow('TTL must be a positive integer');
    await expect(
      redis.upsertPresenceLease(
        {
          connId: 'ok',
          actorId: 'ok',
          instanceId: 'ok',
          // @ts-expect-error deliberately invalid at the runtime boundary
          activity: 'sleeping',
        },
        60,
      ),
    ).rejects.toThrow('Invalid activity');
  } finally {
    redis.close();
  }
});
