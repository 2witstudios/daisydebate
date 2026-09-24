import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import {
  ACTOR_CONNECTIONS_MAX,
  PRESENCE_LIMIT_MAX,
} from '../src/presence-scripts';
import { lease, withRedis } from './test-support';

setupRitewayBun();

const { redisUrl: url } = requireTestServices(process.env);

/**
 * ISSUE-46: every presence read is bounded and read-only, and the online
 * sweep is bounded by the limit cap.
 */
test('readOnlinePresence bounds its result to the given limit', () =>
  withRedis(url, async ({ redis }) => {
    for (const [index, actorId] of [
      createId(),
      createId(),
      createId(),
    ].entries())
      await redis.upsertPresenceLease(lease(`bound${index}`, actorId), 60);
    assert({
      given: 'three online actors and a limit of 2',
      should: 'return two actors',
      actual: (await redis.readOnlinePresence(2)).actors.length,
      expected: 2,
    });
  }));

test('readOnlinePresence never writes: an expired online member is still stored after a read', () =>
  // The negative control for ISSUE-46: putting ZREMRANGEBYSCORE back into
  // readOnlinePresenceScript deletes the ghost below and fails this test.
  withRedis(url, async ({ redis, raw, key, serverNowMs }) => {
    const liveActorId = createId();
    const ghostActorId = createId();
    const onlineKey = key('presence', 'online');
    const ghostScore = (await serverNowMs()) - 5_000;
    await redis.upsertPresenceLease(lease('liveConn', liveActorId), 100);
    await raw.send('ZADD', [onlineKey, String(ghostScore), ghostActorId]);
    assert({
      given: 'a live actor and a ghost scored in the past',
      should: 'list only the live actor and leave the ghost stored',
      actual: {
        online: (await redis.readOnlinePresence(10)).actors.map(
          (actor) => actor.actorId,
        ),
        ghostScore: await raw.send('ZSCORE', [onlineKey, ghostActorId]),
      },
      expected: { online: [liveActorId], ghostScore },
    });
  }));

test('sweepOnlinePresence removes expired members and keeps live ones', () =>
  withRedis(url, async ({ redis, raw, key, serverNowMs }) => {
    const liveActorId = createId();
    const ghostActorId = createId();
    const onlineKey = key('presence', 'online');
    await redis.upsertPresenceLease(lease('liveConn', liveActorId), 100);
    await raw.send('ZADD', [
      onlineKey,
      String((await serverNowMs()) - 5_000),
      ghostActorId,
    ]);
    const removed = await redis.sweepOnlinePresence(10);
    assert({
      given: 'a ghost scored in the past beside a live actor',
      should: 'remove exactly the ghost',
      actual: {
        removed,
        ghost: await raw.send('ZSCORE', [onlineKey, ghostActorId]),
        live: (await raw.send('ZSCORE', [onlineKey, liveActorId])) !== null,
      },
      expected: { removed: 1, ghost: null, live: true },
    });
  }));

test('a sweep at the limit cap removes exactly the cap from a larger backlog, and the next sweep drains the rest', () =>
  // ISSUE-46: the sweep passes every expired member to one ZREM through
  // Lua's unpack, which fails past about 8,000 values ("too many results to
  // unpack", nothing removed). The cap keeps every accepted limit far below
  // that; this proves the cap itself against real Redis.
  withRedis(url, async ({ redis, raw, key, serverNowMs }) => {
    const onlineKey = key('presence', 'online');
    const past = String((await serverNowMs()) - 5_000);
    await raw.send('ZADD', [
      onlineKey,
      ...Array.from({ length: PRESENCE_LIMIT_MAX + 10 }, () => [
        past,
        createId(),
      ]).flat(),
    ]);
    const first = await redis.sweepOnlinePresence(PRESENCE_LIMIT_MAX);
    const second = await redis.sweepOnlinePresence(PRESENCE_LIMIT_MAX);
    assert({
      given: `${PRESENCE_LIMIT_MAX + 10} expired members and two capped sweeps`,
      should: 'remove the cap, then the remaining ten, leaving none',
      actual: { first, second, left: await raw.send('ZCARD', [onlineKey]) },
      expected: { first: PRESENCE_LIMIT_MAX, second: 10, left: 0 },
    });
  }));

test('readActorConnections returns at most its bound, latest expiry first', () =>
  // ISSUE-46: the per-actor read is bounded like the online read, so an
  // actor with many live connections never makes one read unbounded.
  withRedis(url, async ({ redis }) => {
    const actorId = createId();
    const connIds = Array.from(
      { length: ACTOR_CONNECTIONS_MAX + 3 },
      (_, index) => `bounded${index}`,
    );
    for (const [index, connId] of connIds.entries())
      await redis.upsertPresenceLease(lease(connId, actorId), 100 + index);
    assert({
      given: `${ACTOR_CONNECTIONS_MAX + 3} live connections for one actor`,
      should: 'return the bound, latest expiry first',
      actual: (await redis.readActorConnections(actorId)).connections.map(
        (connection) => connection.connId,
      ),
      expected: connIds.slice(3).reverse(),
    });
  }));
