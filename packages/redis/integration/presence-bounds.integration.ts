import { expect, test } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { createRedis, redisKey } from '../src';
import {
  ACTOR_CONNECTIONS_MAX,
  PRESENCE_LIMIT_MAX,
} from '../src/presence-scripts';
import { rawClient } from './test-support';
const url = process.env.TEST_REDIS_URL;
if (!url) throw new Error('TEST_REDIS_URL required');

/**
 * ISSUE-46: every presence read is bounded and read-only, and the online
 * sweep is bounded by the limit cap.
 */
test('readOnlinePresence bounds its result to the given limit', async () => {
  const namespace = `test-${createId()}`;
  const redis = createRedis({ url, namespace });
  const actorIds = [createId(), createId(), createId()];
  try {
    for (const [index, actorId] of actorIds.entries()) {
      await redis.upsertPresenceLease(
        {
          connId: `bound${index}`,
          actorId,
          instanceId: 'inst1',
          activity: 'active',
        },
        60,
      );
    }
    const { actors } = await redis.readOnlinePresence(2);
    expect(actors.length).toBe(2);
  } finally {
    for (const [index, actorId] of actorIds.entries()) {
      await redis.deletePresenceLease({ connId: `bound${index}`, actorId });
    }
    redis.close();
  }
});

test('readOnlinePresence never writes: an expired online member is still stored after a read', async () => {
  // The negative control for ISSUE-46: putting ZREMRANGEBYSCORE back into
  // readOnlinePresenceScript deletes the ghost below and fails this test.
  const namespace = `test-${createId()}`;
  const redis = createRedis({ url, namespace });
  const raw = await rawClient(url);
  const liveActorId = createId();
  const ghostActorId = createId();
  const onlineKey = redisKey(namespace, 'presence', 'online');
  const ghostScore = String(Date.now() - 5_000);
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
    await raw.send('ZADD', [onlineKey, ghostScore, ghostActorId]);

    const { actors } = await redis.readOnlinePresence(10);
    expect(actors.map((actor) => actor.actorId)).toEqual([liveActorId]);
    expect(await raw.send('ZSCORE', [onlineKey, ghostActorId])).toBe(
      Number(ghostScore),
    );
  } finally {
    await redis.deletePresenceLease({
      connId: 'liveConn',
      actorId: liveActorId,
    });
    await raw.send('ZREM', [onlineKey, ghostActorId]);
    redis.close();
    raw.close();
  }
});

test('sweepOnlinePresence removes expired members and keeps live ones', async () => {
  const namespace = `test-${createId()}`;
  const redis = createRedis({ url, namespace });
  const raw = await rawClient(url);
  const liveActorId = createId();
  const ghostActorId = createId();
  const onlineKey = redisKey(namespace, 'presence', 'online');
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
      ghostActorId,
    ]);

    const removed = await redis.sweepOnlinePresence(10);
    expect(removed).toBe(1);
    expect(await raw.send('ZSCORE', [onlineKey, ghostActorId])).toBeNull();
    expect(await raw.send('ZSCORE', [onlineKey, liveActorId])).not.toBeNull();
  } finally {
    await redis.deletePresenceLease({
      connId: 'liveConn',
      actorId: liveActorId,
    });
    await raw.send('ZREM', [onlineKey, ghostActorId]);
    redis.close();
    raw.close();
  }
});

test('a sweep at the limit cap removes exactly the cap from a larger backlog, and the next sweep drains the rest', async () => {
  // ISSUE-46: the sweep passes every expired member to one ZREM through
  // Lua's unpack, which fails past about 8,000 values ("too many results to
  // unpack", nothing removed). The cap keeps every accepted limit far below
  // that; this proves the cap itself against real Redis.
  const namespace = `test-${createId()}`;
  const redis = createRedis({ url, namespace });
  const raw = await rawClient(url);
  const onlineKey = redisKey(namespace, 'presence', 'online');
  const backlog = PRESENCE_LIMIT_MAX + 10;
  const past = String(Date.now() - 5_000);
  try {
    await raw.send('ZADD', [
      onlineKey,
      ...Array.from({ length: backlog }, () => [past, createId()]).flat(),
    ]);
    const first = await redis.sweepOnlinePresence(PRESENCE_LIMIT_MAX);
    const second = await redis.sweepOnlinePresence(PRESENCE_LIMIT_MAX);
    expect({
      first,
      second,
      left: await raw.send('ZCARD', [onlineKey]),
    }).toEqual({ first: PRESENCE_LIMIT_MAX, second: 10, left: 0 });
  } finally {
    await raw.del(onlineKey);
    redis.close();
    raw.close();
  }
});

test('readActorConnections returns at most its bound, latest expiry first', async () => {
  // ISSUE-46: the per-actor read is bounded like the online read, so an
  // actor with many live connections never makes one read unbounded.
  const namespace = `test-${createId()}`;
  const redis = createRedis({ url, namespace });
  const actorId = createId();
  const connIds = Array.from(
    { length: ACTOR_CONNECTIONS_MAX + 3 },
    (_, index) => `bounded${index}`,
  );
  try {
    for (const [index, connId] of connIds.entries())
      await redis.upsertPresenceLease(
        { connId, actorId, instanceId: 'inst1', activity: 'active' },
        100 + index,
      );
    const { connections } = await redis.readActorConnections(actorId);
    expect(connections.map((c) => c.connId)).toEqual(
      connIds.slice(3).reverse(),
    );
  } finally {
    for (const connId of connIds)
      await redis.deletePresenceLease({ connId, actorId });
    redis.close();
  }
});
