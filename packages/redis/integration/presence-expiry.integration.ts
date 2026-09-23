import { expect, test } from 'bun:test';
import { createRedis, redisKey } from '../src';
import { rawClient } from './test-support';
const url = process.env.TEST_REDIS_URL;
if (!url) throw new Error('TEST_REDIS_URL required');

test('readActorConnections trims members scored in the past, one at a time, deterministically', async () => {
  // Simulates a crashed instance whose leases were never refreshed. Rather
  // than waiting on real TTLs (flaky under host load — a prior version of
  // this test depended on a ~0.5s margin around real sleeps), each
  // connId's score is rewritten directly through a raw client to a fixed
  // point relative to now, so the trim is proven by the scores alone. The
  // hashes carry a long TTL throughout, so a read that omits a member must
  // have done so via ZREMRANGEBYSCORE, not because the hash disappeared.
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  const raw = await rawClient(url);
  const actorId = 'crashedActor';
  const actorKey = redisKey(namespace, 'presence', 'actor', actorId);
  try {
    await redis.upsertPresenceLease(
      {
        connId: 'shortLease',
        actorId,
        instanceId: 'deadInstance',
        activity: 'active',
      },
      100,
    );
    await redis.upsertPresenceLease(
      {
        connId: 'midLease',
        actorId,
        instanceId: 'deadInstance',
        activity: 'active',
      },
      100,
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

    // Rewrite the scores: shortLease already lapsed, the other two have not.
    const now = Date.now();
    await raw.send('ZADD', [actorKey, String(now - 10_000), 'shortLease']);
    await raw.send('ZADD', [actorKey, String(now + 100_000), 'midLease']);
    await raw.send('ZADD', [actorKey, String(now + 100_000), 'longLease']);

    const first = await redis.readActorConnections(actorId);
    expect(first.map((c) => c.connId).sort()).toEqual([
      'longLease',
      'midLease',
    ]);

    // Now midLease also lapses; a fresh read reflects only this member
    // dropping, one at a time, never all together.
    await raw.send('ZADD', [actorKey, String(now - 10_000), 'midLease']);
    const second = await redis.readActorConnections(actorId);
    expect(second.map((c) => c.connId)).toEqual(['longLease']);
  } finally {
    await redis.deletePresenceLease({ connId: 'shortLease', actorId });
    await redis.deletePresenceLease({ connId: 'midLease', actorId });
    await redis.deletePresenceLease({ connId: 'longLease', actorId });
    redis.close();
    raw.close();
  }
});

test('readOnlinePresence trims actors scored in the past', async () => {
  // Same deterministic technique as the connections read above, applied to
  // the online zset: a ghost actor's lapsed lease is seeded directly, with
  // no dependency on real time passing.
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  const raw = await rawClient(url);
  const onlineKey = redisKey(namespace, 'presence', 'online');
  const liveActorId = 'liveActor';
  try {
    await redis.upsertPresenceLease(
      {
        connId: 'liveConn',
        actorId: liveActorId,
        instanceId: 'inst1',
        activity: 'active',
      },
      100,
    );
    await raw.send('ZADD', [
      onlineKey,
      String(Date.now() - 5_000),
      'ghostActor',
    ]);

    const online = await redis.readOnlinePresence();
    expect(online.map((a) => a.actorId)).toEqual([liveActorId]);
  } finally {
    await redis.deletePresenceLease({
      connId: 'liveConn',
      actorId: liveActorId,
    });
    await raw.send('ZREM', [onlineKey, 'ghostActor']);
    redis.close();
    raw.close();
  }
});

test('a lease is a real Redis TTL: the hash physically disappears without a delete', async () => {
  // Proves the mandatory TTL is a genuine server-side expiry, not only our
  // own read trim. Checked directly against Redis with a raw client, so
  // removing the PEXPIRE in the write script would fail this test.
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  const raw = await rawClient(url);
  const actorId = 'ttlActor';
  const connKey = redisKey(namespace, 'presence', 'conn', 'ttlConn');
  try {
    await redis.upsertPresenceLease(
      { connId: 'ttlConn', actorId, instanceId: 'inst1', activity: 'active' },
      3,
    );
    expect(await raw.exists(connKey)).toBe(true);
    expect(
      (await redis.readActorConnections(actorId)).map((c) => c.connId),
    ).toEqual(['ttlConn']);

    // A full second of margin over the 3s TTL, so this never depends on a
    // tight race under host load.
    await Bun.sleep(4_000);

    // Independent of our own read/trim logic: the hash is simply gone.
    expect(await raw.exists(connKey)).toBe(false);
    expect(await redis.readActorConnections(actorId)).toEqual([]);
  } finally {
    await redis.deletePresenceLease({ connId: 'ttlConn', actorId });
    redis.close();
    raw.close();
  }
}, 15_000);

test('refresh on an already-expired lease reports refreshed: false rather than reviving it', async () => {
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  const actorId = 'staleActor';
  try {
    await redis.upsertPresenceLease(
      { connId: 'staleConn', actorId, instanceId: 'inst1', activity: 'active' },
      3,
    );
    // A full second of margin over the 3s TTL, so this never depends on a
    // tight race under host load.
    await Bun.sleep(4_000);

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
  const raw = await rawClient(url);
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

test('a delete never propagates a stale leftover member into the online zset', async () => {
  // Reproduces the sequence a reviewer found: one connection (staleConn)
  // lapses without ever being read, so its stale, past-scored member is
  // still sitting in the actor zset. Deleting the OTHER, still-live
  // connection must not read staleConn's leftover score as the new "top"
  // and ZADD it straight back into the online zset — that would leave a
  // stale member there with a past score.
  //
  // A second, unrelated actor (neighborActor) stays live throughout with a
  // long TTL, so the online zset itself is never at risk of physically
  // expiring during this test (per-member scores carry no TTL of their
  // own; only the whole key does, and neighborActor's lease keeps that key
  // real and long-lived). That makes the assertion on onlineKey's member
  // and score below deterministic, unlike checking EXISTS on a key whose
  // own recreation would carry only a 1 ms clamped expiry (arm() clamps
  // any past score's ttl to 1 ms) — that races Redis's lazy expiry and
  // measured 4 of 8 failures under this exact mutation.
  const namespace = `test-${crypto.randomUUID().slice(0, 8)}`;
  const redis = createRedis({ url, namespace });
  const raw = await rawClient(url);
  const actorId = 'duplicateDeleteActor';
  const neighborActorId = 'duplicateDeleteNeighbor';
  const actorKey = redisKey(namespace, 'presence', 'actor', actorId);
  const onlineKey = redisKey(namespace, 'presence', 'online');
  try {
    await redis.upsertPresenceLease(
      {
        connId: 'neighborConn',
        actorId: neighborActorId,
        instanceId: 'inst0',
        activity: 'active',
      },
      100,
    );
    await redis.upsertPresenceLease(
      {
        connId: 'longConn',
        actorId,
        instanceId: 'inst1',
        activity: 'active',
      },
      100,
    );
    await redis.upsertPresenceLease(
      {
        connId: 'staleConn',
        actorId,
        instanceId: 'inst2',
        activity: 'active',
      },
      100,
    );
    // staleConn lapsed without ever being read: its hash is gone (as a
    // physical TTL eventually would do) but its zset member is still there
    // with a now-past score.
    await raw.send('ZADD', [
      actorKey,
      String(Date.now() - 10_000),
      'staleConn',
    ]);
    await raw.del(redisKey(namespace, 'presence', 'conn', 'staleConn'));

    await redis.deletePresenceLease({ connId: 'longConn', actorId });

    // The deterministic oracle: the online zset itself (kept alive by
    // neighborActor, so this cannot race a physical expiry) must not carry
    // this actor's member at all, stale score or not.
    expect(await raw.send('ZSCORE', [onlineKey, actorId])).toBeNull();
    // Contract coverage, not the oracle above: readOnlinePresence() runs
    // its own score-based trim before returning, so a stale member is
    // filtered out here regardless of whether the delete script's purge
    // ran — this cannot fail under the mutation this test targets, but it
    // does prove the actor's own connections stay absent from the public
    // read.
    expect(
      (await redis.readOnlinePresence()).some(
        (actor) => actor.actorId === actorId,
      ),
    ).toBe(false);
    // Extra, also deterministic: the actor zset's own expiry is armed to
    // cover the longest live lease (100 s here), so it cannot physically
    // expire mid-test either. With the purge, ZREM leaves it empty and
    // Redis drops the now-empty key; without it, staleConn's past-scored
    // member survives and the key still exists.
    expect(await raw.exists(actorKey)).toBe(false);
  } finally {
    await redis.deletePresenceLease({ connId: 'longConn', actorId });
    await redis.deletePresenceLease({ connId: 'staleConn', actorId });
    await redis.deletePresenceLease({
      connId: 'neighborConn',
      actorId: neighborActorId,
    });
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
