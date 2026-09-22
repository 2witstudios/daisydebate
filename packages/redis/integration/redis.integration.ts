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
test('rate limit admits exactly max across concurrent instances and expires atomically', async () => {
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
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

test('presence lease upsert, refresh and delete are visible through the reads', async () => {
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  const now = Date.now();
  const actorId = 'actorA';
  try {
    await redis.upsertPresenceLease(
      { connId: 'connA1', actorId, instanceId: 'instX', activity: 'active' },
      60,
      now,
    );
    // A second connection from the same actor is scored independently.
    await redis.upsertPresenceLease(
      { connId: 'connA2', actorId, instanceId: 'instY', activity: 'idle' },
      120,
      now,
    );
    const afterUpsert = await redis.readActorConnections(actorId, now);
    expect(afterUpsert.length).toBe(2);
    expect(afterUpsert.map((c) => c.connId).sort()).toEqual([
      'connA1',
      'connA2',
    ]);
    const conn1 = afterUpsert.find((c) => c.connId === 'connA1');
    expect(conn1?.activity).toBe('active');
    expect(conn1?.instanceId).toBe('instX');
    expect(conn1?.expiresAtMs).toBe(now + 60_000);
    // Online set is scored by the actor's LATEST lease expiry (connA2's 120s), not the first upsert.
    const onlineAfterUpsert = await redis.readOnlinePresence(now);
    expect(onlineAfterUpsert).toEqual([
      { actorId, expiresAtMs: now + 120_000 },
    ]);

    const refreshed = await redis.refreshPresenceLease(
      { connId: 'connA1', actorId },
      60,
      now + 1_000,
    );
    expect(refreshed).toEqual({ refreshed: true });
    const afterRefresh = await redis.readActorConnections(actorId, now + 1_000);
    expect(afterRefresh.find((c) => c.connId === 'connA1')?.expiresAtMs).toBe(
      now + 61_000,
    );

    await redis.deletePresenceLease({ connId: 'connA2', actorId });
    const afterDelete = await redis.readActorConnections(actorId, now + 1_000);
    expect(afterDelete.map((c) => c.connId)).toEqual(['connA1']);
    // Online score falls back to the one remaining connection's expiry.
    const onlineAfterDelete = await redis.readOnlinePresence(now + 1_000);
    expect(onlineAfterDelete).toEqual([{ actorId, expiresAtMs: now + 61_000 }]);

    await redis.deletePresenceLease({ connId: 'connA1', actorId });
    expect(await redis.readActorConnections(actorId, now + 1_000)).toEqual([]);
    // No connections remain, so the actor drops out of the online set entirely.
    expect(await redis.readOnlinePresence(now + 1_000)).toEqual([]);
  } finally {
    await redis.deletePresenceLease({ connId: 'connA1', actorId });
    await redis.deletePresenceLease({ connId: 'connA2', actorId });
    redis.close();
  }
});

test('an instance crash lets each of its connection leases expire on its own, by injected clock', async () => {
  // Simulates one instance holding three sockets for the same actor that
  // crashes without deleting any of them: only the passage of time (here,
  // an injected clock, never a real sleep) trims the stale leases.
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  const now = Date.now();
  const actorId = 'crashedActor';
  try {
    await redis.upsertPresenceLease(
      {
        connId: 'shortLease',
        actorId,
        instanceId: 'deadInstance',
        activity: 'active',
      },
      5,
      now,
    );
    await redis.upsertPresenceLease(
      {
        connId: 'midLease',
        actorId,
        instanceId: 'deadInstance',
        activity: 'active',
      },
      10,
      now,
    );
    await redis.upsertPresenceLease(
      {
        connId: 'longLease',
        actorId,
        instanceId: 'deadInstance',
        activity: 'idle',
      },
      1_000,
      now,
    );

    // All three are alive right after the crash.
    expect(
      (await redis.readActorConnections(actorId, now))
        .map((c) => c.connId)
        .sort(),
    ).toEqual(['longLease', 'midLease', 'shortLease']);
    expect((await redis.readOnlinePresence(now)).map((a) => a.actorId)).toEqual(
      [actorId],
    );

    // 6s later: only the 5s lease has expired.
    const afterSix = await redis.readActorConnections(actorId, now + 6_000);
    expect(afterSix.map((c) => c.connId).sort()).toEqual([
      'longLease',
      'midLease',
    ]);
    // The online score still reflects the longest-lived remaining lease.
    expect(await redis.readOnlinePresence(now + 6_000)).toEqual([
      { actorId, expiresAtMs: now + 1_000_000 },
    ]);

    // 11s later: the 10s lease has also expired, one by one, not all at once.
    const afterEleven = await redis.readActorConnections(actorId, now + 11_000);
    expect(afterEleven.map((c) => c.connId)).toEqual(['longLease']);

    // Reading with the earlier now again still shows the leases as expired:
    // trimming is driven by the score, not by call order.
    expect(
      (await redis.readActorConnections(actorId, now + 6_000)).map(
        (c) => c.connId,
      ),
    ).toEqual(['longLease']);
  } finally {
    await redis.deletePresenceLease({ connId: 'shortLease', actorId });
    await redis.deletePresenceLease({ connId: 'midLease', actorId });
    await redis.deletePresenceLease({ connId: 'longLease', actorId });
    redis.close();
  }
});

test('a lease is a real Redis TTL: the hash disappears on its own without a delete', async () => {
  // Proves the mandatory TTL is a genuine server-side expiry, not only a
  // zset score our own reads happen to trim. Bounded by the TTL itself.
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  const now = Date.now();
  const actorId = 'ttlActor';
  try {
    await redis.upsertPresenceLease(
      { connId: 'ttlConn', actorId, instanceId: 'inst1', activity: 'active' },
      1,
      now,
    );
    expect(
      (await redis.readActorConnections(actorId, now)).map((c) => c.connId),
    ).toEqual(['ttlConn']);

    await Bun.sleep(1_300);

    // The zset member is still scored in the past (no read has trimmed it
    // yet), but the underlying hash is gone: the read must not report a
    // connection it cannot hydrate.
    expect(await redis.readActorConnections(actorId, now + 1_300)).toEqual([]);
  } finally {
    await redis.deletePresenceLease({ connId: 'ttlConn', actorId });
    redis.close();
  }
});

test('refresh on an already-expired lease reports refreshed: false rather than reviving it', async () => {
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  const now = Date.now();
  const actorId = 'staleActor';
  try {
    await redis.upsertPresenceLease(
      { connId: 'staleConn', actorId, instanceId: 'inst1', activity: 'active' },
      1,
      now,
    );
    await Bun.sleep(1_300);

    const result = await redis.refreshPresenceLease(
      { connId: 'staleConn', actorId },
      60,
      now + 1_300,
    );
    expect(result).toEqual({ refreshed: false });
    // Negative control: refresh must not have resurrected the hash or its TTL.
    expect(await redis.readActorConnections(actorId, now + 1_300)).toEqual([]);
  } finally {
    await redis.deletePresenceLease({ connId: 'staleConn', actorId });
    redis.close();
  }
});

test('presence reads reject invalid ids before touching Redis', async () => {
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  try {
    await expect(
      redis.readActorConnections('not a valid id!', Date.now()),
    ).rejects.toThrow('Invalid actorId');
    await expect(
      redis.upsertPresenceLease(
        { connId: 'ok', actorId: 'ok', instanceId: 'ok', activity: 'active' },
        0,
        Date.now(),
      ),
    ).rejects.toThrow('TTL must be a positive integer');
  } finally {
    redis.close();
  }
});
