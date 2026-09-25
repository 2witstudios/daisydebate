import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createRedis, redisKey } from './index';
import { createOfflineRedis, createTestRedis } from './test-support';

setupRitewayBun();

describe('redisKey', () => {
  test('namespace is explicit and unambiguous', () => {
    assert({
      given: 'a namespace, domain and segment',
      should: 'compose the versioned key',
      actual: redisKey('daisy', 'presence', 'user-1'),
      expected: 'daisy:v1:presence:user-1',
    });
    expect(() => redisKey('daisy', 'a:b')).toThrow('Invalid Redis key segment');
  });
});

describe('redis adapter', () => {
  test('reports healthy when the server answers ping', async () => {
    const { redis } = createTestRedis();

    assert({
      given: 'a reachable Redis server',
      should: 'report health',
      actual: await redis.health(),
      expected: true,
    });
  });

  test('stores values under the namespaced key with an expiry', async () => {
    const { redis, commands } = createTestRedis();

    await redis.setEphemeral('presence-user-1', 'lobby', 60);

    assert({
      given: 'an ephemeral value with a positive TTL',
      should: 'store it under the namespaced key with an expiry command',
      actual: commands.find(({ command }) => command === 'SET'),
      expected: {
        command: 'SET',
        args: ['test:v1:presence-user-1', 'lobby', 'EX', '60'],
      },
    });
  });

  test('refuses invalid TTLs before issuing any command', async () => {
    const { redis, commands } = createTestRedis();

    await expect(
      redis.setEphemeral('presence-user-1', 'lobby', 0),
    ).rejects.toThrow('TTL must be a positive integer');

    assert({
      given: 'an ephemeral write without a positive integer TTL',
      should: 'leave the server untouched',
      actual: commands,
      expected: [],
    });
  });

  test('reads values back from under the namespaced key', async () => {
    const { redis } = createTestRedis(
      undefined,
      new Map([['test:v1:session-a', 'payload']]),
    );

    assert({
      given: 'a stored value under its namespaced key',
      should: 'read it back through the namespace',
      actual: await redis.get('session-a'),
      expected: 'payload',
    });
  });

  test('deletes values from under the namespaced key', async () => {
    const { redis, commands } = createTestRedis(
      undefined,
      new Map([['test:v1:session-a', 'payload']]),
    );

    await redis.delete('session-a');

    assert({
      given: 'a stored value',
      should: 'remove it from under its namespaced key',
      actual: [
        commands.find(({ command }) => command === 'DEL')?.args,
        await redis.get('session-a'),
      ],
      expected: [['test:v1:session-a'], null],
    });
  });

  test('closes the connection', async () => {
    const { redis, isClosed } = createTestRedis();

    redis.close();

    assert({
      given: 'a closed adapter',
      should: 'release the underlying client',
      actual: isClosed(),
      expected: true,
    });
  });
});

describe('redis adapter failures', () => {
  test('reports a failed command through the injected event sink', async () => {
    const events: Array<{
      event: string;
      fields: Record<string, unknown>;
      message: string;
    }> = [];
    const redis = createRedis({
      url: 'redis://127.0.0.1:1',
      namespace: 'test',
      eventSink: (event, fields, message) =>
        events.push({ event, fields, message }),
    });

    await expect(redis.get('key')).rejects.toMatchObject({
      code: 'ERR_REDIS_CONNECTION_CLOSED',
    });

    assert({
      given: 'a Redis command that fails',
      should: 'emit the Redis command failure event with the operation name',
      actual: events,
      expected: [
        {
          event: 'redis.command.failed',
          fields: { operation: 'get' },
          message: 'Redis command failed',
        },
      ],
    });
  });
});

describe('redis alert counters (AUTH-7.7)', () => {
  test('setIfAbsent issues one namespaced EVAL carrying the value and TTL', async () => {
    const { redis, commands } = createTestRedis();
    await redis.setIfAbsent('alert-unavailable-storage', '2026-09-25T00:00:00.000Z', 180);
    const evals = commands.filter(({ command }) => command === 'EVAL');
    assert({
      given: 'a first-observed marker with a positive TTL',
      should: 'run exactly one Lua EVAL against one namespaced key with the value and TTL in ms',
      actual: {
        count: evals.length,
        key: evals[0]?.args[2],
        value: evals[0]?.args[3],
        ttlMs: evals[0]?.args[4],
      },
      expected: {
        count: 1,
        key: 'test:v1:alert-unavailable-storage',
        value: '2026-09-25T00:00:00.000Z',
        ttlMs: '180000',
      },
    });
  });

  test('setIfAbsent returns the stored value', async () => {
    const { redis, scriptEval } = createTestRedis();
    scriptEval('2026-09-25T00:00:00.000Z');
    assert({
      given: 'a script result returning the winning value',
      should: 'return that value to the caller',
      actual: await redis.setIfAbsent('alert-unavailable-storage', 'ignored', 180),
      expected: '2026-09-25T00:00:00.000Z',
    });
  });

  test('setIfAbsent refuses a non-positive-integer TTL before touching Redis', async () => {
    const { redis, commands } = createTestRedis();
    await expect(redis.setIfAbsent('k', 'v', 0)).rejects.toThrow(
      'TTL must be a positive integer',
    );
    assert({
      given: 'an invalid TTL',
      should: 'issue no Redis command',
      actual: commands.length,
      expected: 0,
    });
  });

  test('incrementWithExpiry issues one namespaced EVAL carrying the TTL', async () => {
    const { redis, commands, scriptEval } = createTestRedis();
    scriptEval(1);
    await redis.incrementWithExpiry('alert-mail-consecutive-failures', 3600);
    const evals = commands.filter(({ command }) => command === 'EVAL');
    assert({
      given: 'a bounded counter increment with a positive TTL',
      should: 'run exactly one Lua EVAL against one namespaced key with the TTL in ms',
      actual: {
        count: evals.length,
        key: evals[0]?.args[2],
        ttlMs: evals[0]?.args[3],
      },
      expected: {
        count: 1,
        key: 'test:v1:alert-mail-consecutive-failures',
        ttlMs: '3600000',
      },
    });
  });

  test('incrementWithExpiry returns the new count', async () => {
    const { redis, scriptEval } = createTestRedis();
    scriptEval(3);
    assert({
      given: 'a script result returning the incremented count',
      should: 'return that count to the caller',
      actual: await redis.incrementWithExpiry('alert-mail-consecutive-failures', 3600),
      expected: 3,
    });
  });

  test('incrementWithExpiry refuses a non-positive-integer TTL before touching Redis', async () => {
    const { redis, commands } = createTestRedis();
    await expect(redis.incrementWithExpiry('k', 0)).rejects.toThrow(
      'TTL must be a positive integer',
    );
    assert({
      given: 'an invalid TTL',
      should: 'issue no Redis command',
      actual: commands.length,
      expected: 0,
    });
  });

  test('propagates outage and reports it without swallowing', async () => {
    const events: Array<{ event: string; fields: Record<string, unknown> }> =
      [];
    const redis = createOfflineRedis(events);
    await expect(
      redis.setIfAbsent('alert-unavailable-storage', 'v', 180),
    ).rejects.toThrow('offline');
    await expect(
      redis.incrementWithExpiry('alert-mail-consecutive-failures', 3600),
    ).rejects.toThrow('offline');
    assert({
      given: 'an unreachable Redis',
      should: 'emit a failure event naming each operation',
      actual: events,
      expected: [
        { event: 'redis.command.failed', fields: { operation: 'setIfAbsent' } },
        {
          event: 'redis.command.failed',
          fields: { operation: 'incrementWithExpiry' },
        },
      ],
    });
  });
});

describe('redis atomic rate limit', () => {
  test('issues one namespaced EVAL with hashed-safe key, window and max', async () => {
    const { redis, commands } = createTestRedis();
    const decision = await redis.consumeRateLimit('a1b2c3', {
      windowSeconds: 60,
      max: 3,
    });
    const evals = commands.filter(({ command }) => command === 'EVAL');
    assert({
      given: 'one rate-limit consume',
      should: 'run exactly one Lua EVAL against one namespaced expiring key',
      actual: {
        count: evals.length,
        keyCount: evals[0]?.args[1],
        key: evals[0]?.args[2],
        windowMs: evals[0]?.args[3],
        max: evals[0]?.args[4],
        allowed: decision.allowed,
      },
      expected: {
        count: 1,
        keyCount: '1',
        key: 'test:v1:rl:a1b2c3',
        windowMs: '60000',
        max: '3',
        allowed: true,
      },
    });
  });

  test('maps a rejected script result to retry seconds rounded up', async () => {
    const { redis, scriptEval } = createTestRedis();
    scriptEval([0, 1200]);
    assert({
      given: 'a script result that rejects with 1200ms of window left',
      should: 'report a denied decision and a 2 second retry',
      actual: await redis.consumeRateLimit('k1', {
        windowSeconds: 60,
        max: 3,
      }),
      expected: { allowed: false, retryAfterSeconds: 2 },
    });
  });

  test('rejects invalid keys and rules before touching Redis', async () => {
    const { redis, commands } = createTestRedis();
    await expect(
      redis.consumeRateLimit('bad key!', { windowSeconds: 60, max: 3 }),
    ).rejects.toThrow('Invalid Redis key segment');
    await expect(
      redis.consumeRateLimit('ok', { windowSeconds: 0, max: 3 }),
    ).rejects.toThrow('Invalid rate limit rule');
    await expect(
      redis.consumeRateLimit('ok', { windowSeconds: 60, max: 0 }),
    ).rejects.toThrow('Invalid rate limit rule');
    assert({
      given: 'invalid limiter input',
      should: 'issue no Redis command',
      actual: commands.length,
      expected: 0,
    });
  });

  test('propagates outage and reports it without swallowing', async () => {
    const events: Array<{ event: string; fields: Record<string, unknown> }> =
      [];
    const redis = createOfflineRedis(events);
    await expect(
      redis.consumeRateLimit('ok', { windowSeconds: 60, max: 3 }),
    ).rejects.toThrow('offline');
    assert({
      given: 'an unreachable Redis',
      should: 'emit a failure event naming the operation',
      actual: events,
      expected: [
        {
          event: 'redis.command.failed',
          fields: { operation: 'consumeRateLimit' },
        },
      ],
    });
  });
});
