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
      1_000,
    );
    const evals = commands.filter(({ command }) => command === 'EVAL');
    assert({
      given: 'a presence lease upsert',
      should:
        'issue exactly one EVAL over three namespaced keys with the TTL and score',
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
        rest: ['actor1', 'active', 'inst1', '60000', '61000', 'conn1'],
      },
    });
  });

  test('rejects invalid ids and TTLs before touching Redis', async () => {
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
        1_000,
      ),
    ).rejects.toThrow('Invalid connId');
    await expect(
      redis.upsertPresenceLease(
        {
          connId: 'conn1',
          actorId: 'actor1',
          instanceId: 'inst1',
          activity: 'active',
        },
        0,
        1_000,
      ),
    ).rejects.toThrow('TTL must be a positive integer');
    assert({
      given: 'invalid connId or TTL',
      should: 'issue no Redis command',
      actual: commands.length,
      expected: 0,
    });
  });
});

describe('presence lease refresh', () => {
  test('extends the TTL and rescores the lease', async () => {
    const { redis, commands } = createTestRedis();
    await redis.refreshPresenceLease(
      { connId: 'conn1', actorId: 'actor1' },
      60,
      5_000,
    );
    const evals = commands.filter(({ command }) => command === 'EVAL');
    assert({
      given: 'a refresh of a live lease',
      should: 'issue one EVAL with the new TTL, score, connId and actorId',
      actual: evals[0]?.args.slice(2),
      expected: [
        'test:v1:presence:conn:conn1',
        'test:v1:presence:actor:actor1',
        'test:v1:presence:online',
        '60000',
        '65000',
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
        5_000,
      ),
      expected: { refreshed: false },
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
  test('trims expired members then hydrates each live connection from its hash', async () => {
    const hashes = new Map([
      [
        'test:v1:presence:conn:conn1',
        { actorId: 'actor1', activity: 'active', instanceId: 'inst1' },
      ],
    ]);
    const { redis, scriptEval, commands } = createTestRedis(
      undefined,
      undefined,
      hashes,
    );
    scriptEval(['conn1', '9000']);
    const connections = await redis.readActorConnections('actor1', 5_000);
    assert({
      given: 'an actor with one live connection',
      should: 'trim by score then hydrate the surviving connId from its hash',
      actual: [
        connections,
        commands.find(({ command }) => command === 'EVAL')?.args.slice(1),
        commands.find(({ command }) => command === 'HGETALL')?.args,
      ],
      expected: [
        [
          {
            connId: 'conn1',
            actorId: 'actor1',
            activity: 'active',
            instanceId: 'inst1',
            expiresAtMs: 9000,
          },
        ],
        ['1', 'test:v1:presence:actor:actor1', '5000'],
        ['test:v1:presence:conn:conn1'],
      ],
    });
  });

  test('drops a zset survivor whose hash already expired instead of reporting it live', async () => {
    const { redis, scriptEval } = createTestRedis();
    scriptEval(['conn1', '9000']);
    assert({
      given:
        'a connId that survived the zset trim but whose hash TTL already fired',
      should:
        'omit it from the live connections rather than returning partial data',
      actual: await redis.readActorConnections('actor1', 5_000),
      expected: [],
    });
  });

  test('reads the online set, trimming actors whose latest lease has expired', async () => {
    const { redis, scriptEval, commands } = createTestRedis();
    scriptEval(['actor1', '9000', 'actor2', '12000']);
    const online = await redis.readOnlinePresence(5_000);
    assert({
      given: 'the online set with two live actors',
      should: 'return them with their expiry scores after trimming',
      actual: [
        online,
        commands.find(({ command }) => command === 'EVAL')?.args.slice(1),
      ],
      expected: [
        [
          { actorId: 'actor1', expiresAtMs: 9000 },
          { actorId: 'actor2', expiresAtMs: 12000 },
        ],
        ['1', 'test:v1:presence:online', '5000'],
      ],
    });
  });

  test('rejects a negative injected clock before touching Redis', async () => {
    const { redis, commands } = createTestRedis();
    await expect(redis.readOnlinePresence(-1)).rejects.toThrow(
      'now must be a non-negative integer epoch millisecond',
    );
    assert({
      given: 'a negative now',
      should: 'issue no Redis command',
      actual: commands.length,
      expected: 0,
    });
  });
});
