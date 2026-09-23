import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestRedis } from './test-support';

setupRitewayBun();

describe('presence lease upsert', () => {
  test('runs one namespaced atomic EVAL scoring the conn, actor and online keys', async () => {
    const { redis, commands } = createTestRedis();
    await redis.upsertPresenceLease(
      {
        connId: 'conn1',
        actorId: 'actor1',
        instanceId: 'inst1',
        activity: 'active',
      },
      60,
    );
    const evals = commands.filter(({ command }) => command === 'EVAL');
    assert({
      given: 'a presence lease upsert',
      should:
        'issue exactly one EVAL over three namespaced keys with the TTL, actorId, activity, instanceId and connId; no client-computed score or now',
      actual: {
        count: evals.length,
        keyCount: evals[0]?.args[1],
        keys: evals[0]?.args.slice(2, 5),
        rest: evals[0]?.args.slice(5),
      },
      expected: {
        count: 1,
        keyCount: '3',
        keys: [
          'test:v1:presence:conn:conn1',
          'test:v1:presence:actor:actor1',
          'test:v1:presence:online',
        ],
        rest: ['actor1', 'active', 'inst1', '60000', 'conn1'],
      },
    });
  });

  test('rejects invalid ids, activity and TTLs before touching Redis', async () => {
    const { redis, commands } = createTestRedis();
    await expect(
      redis.upsertPresenceLease(
        {
          connId: 'bad key!',
          actorId: 'actor1',
          instanceId: 'inst1',
          activity: 'active',
        },
        60,
      ),
    ).rejects.toThrow('Invalid connId');
    await expect(
      redis.upsertPresenceLease(
        {
          connId: 'conn1',
          actorId: 'actor1',
          instanceId: 'inst1',
          // @ts-expect-error deliberately invalid at the runtime boundary
          activity: 'whatever',
        },
        60,
      ),
    ).rejects.toThrow('Invalid activity');
    await expect(
      redis.upsertPresenceLease(
        {
          connId: 'conn1',
          actorId: 'actor1',
          instanceId: 'inst1',
          activity: 'active',
        },
        0,
      ),
    ).rejects.toThrow('TTL must be a positive integer');
    assert({
      given: 'an invalid connId, activity value, or TTL',
      should: 'issue no Redis command',
      actual: commands.length,
      expected: 0,
    });
  });
});

describe('presence lease refresh', () => {
  test('extends the TTL and rescores the lease, with no client-computed score', async () => {
    const { redis, commands } = createTestRedis();
    await redis.refreshPresenceLease(
      { connId: 'conn1', actorId: 'actor1' },
      60,
    );
    const evals = commands.filter(({ command }) => command === 'EVAL');
    assert({
      given: 'a refresh of a live lease',
      should: 'issue one EVAL with the new TTL, connId and actorId',
      actual: evals[0]?.args.slice(2),
      expected: [
        'test:v1:presence:conn:conn1',
        'test:v1:presence:actor:actor1',
        'test:v1:presence:online',
        '60000',
        'conn1',
        'actor1',
      ],
    });
  });

  test('reports refreshed: false when the underlying lease already expired', async () => {
    const { redis, scriptEval } = createTestRedis();
    scriptEval(0);
    assert({
      given: 'a refresh whose connection hash already TTL’d out',
      should: 'return refreshed: false rather than resurrecting the lease',
      actual: await redis.refreshPresenceLease(
        { connId: 'conn1', actorId: 'actor1' },
        60,
      ),
      expected: { refreshed: false },
    });
  });

  test('rejects an invalid TTL before touching Redis', async () => {
    const { redis, commands } = createTestRedis();
    await expect(
      redis.refreshPresenceLease({ connId: 'conn1', actorId: 'actor1' }, 0),
    ).rejects.toThrow('TTL must be a positive integer');
    assert({
      given: 'an invalid TTL',
      should: 'issue no Redis command',
      actual: commands.length,
      expected: 0,
    });
  });
});

describe('presence lease delete', () => {
  test('runs one namespaced atomic EVAL over the conn, actor and online keys', async () => {
    const { redis, commands } = createTestRedis();
    await redis.deletePresenceLease({ connId: 'conn1', actorId: 'actor1' });
    const evals = commands.filter(({ command }) => command === 'EVAL');
    assert({
      given: 'a clean disconnect',
      should: 'issue one EVAL naming the connId and actorId',
      actual: evals[0]?.args.slice(2),
      expected: [
        'test:v1:presence:conn:conn1',
        'test:v1:presence:actor:actor1',
        'test:v1:presence:online',
        'conn1',
        'actor1',
      ],
    });
  });

  test('rejects invalid ids before touching Redis', async () => {
    const { redis, commands } = createTestRedis();
    await expect(
      redis.deletePresenceLease({ connId: 'bad key!', actorId: 'actor1' }),
    ).rejects.toThrow('Invalid connId');
    assert({
      given: 'an invalid connId',
      should: 'issue no Redis command',
      actual: commands.length,
      expected: 0,
    });
  });
});

describe('presence reads', () => {
  test('issues one EVAL per read, with no client-injected now, and parses the Redis now plus the flat hydrated record', async () => {
    const { redis, scriptEval, commands } = createTestRedis();
    scriptEval([5000, 'conn1', 'actor1', 'active', 'inst1', '9000']);
    const { connections, nowMs } = await redis.readActorConnections('actor1');
    const evals = commands.filter(({ command }) => command === 'EVAL');
    assert({
      given: 'a live connection returned by the one-op read',
      should:
        'issue exactly one EVAL naming the actor zset key, the actorId and the conn-hash key prefix, and parse the Redis now plus the flat 5-tuple',
      actual: {
        evalCount: evals.length,
        evalArgs: evals[0]?.args.slice(1),
        nowMs,
        connections,
      },
      expected: {
        evalCount: 1,
        evalArgs: [
          '1',
          'test:v1:presence:actor:actor1',
          'actor1',
          'test:v1:presence:conn:',
        ],
        nowMs: 5000,
        connections: [
          {
            connId: 'conn1',
            actorId: 'actor1',
            activity: 'active',
            instanceId: 'inst1',
            expiresAtMs: 9000,
          },
        ],
      },
    });
  });

  test('reads the online set in one EVAL with no client-injected now, returning the Redis now alongside the pairs', async () => {
    const { redis, scriptEval, commands } = createTestRedis();
    scriptEval([5000, 'actor1', '9000', 'actor2', '12000']);
    const { actors, nowMs } = await redis.readOnlinePresence();
    const evals = commands.filter(({ command }) => command === 'EVAL');
    assert({
      given: 'the online set with two live actors',
      should:
        'issue one EVAL naming only the online key, and parse the Redis now plus the pairs',
      actual: {
        evalCount: evals.length,
        evalArgs: evals[0]?.args.slice(1),
        nowMs,
        actors,
      },
      expected: {
        evalCount: 1,
        evalArgs: ['1', 'test:v1:presence:online'],
        nowMs: 5000,
        actors: [
          { actorId: 'actor1', expiresAtMs: 9000 },
          { actorId: 'actor2', expiresAtMs: 12000 },
        ],
      },
    });
  });

  test('rejects an invalid actorId before touching Redis', async () => {
    const { redis, commands } = createTestRedis();
    await expect(redis.readActorConnections('bad id!')).rejects.toThrow(
      'Invalid actorId',
    );
    assert({
      given: 'an invalid actorId',
      should: 'issue no Redis command',
      actual: commands.length,
      expected: 0,
    });
  });
});
