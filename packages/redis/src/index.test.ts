import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { redisKey } from './index';
import { createRedis } from './index';

setupRitewayBun();

type RecordedCommand = { command: string; args: string[] };

/**
 * Stands in for the Redis wire protocol only: records issued commands and
 * returns scripted values, so the adapter's namespacing, TTL and failure
 * semantics are exercised without a live server.
 */
function fakeRedis(
  values: Map<string, string> = new Map(),
  hashes: Map<string, Record<string, string>> = new Map(),
) {
  const commands: RecordedCommand[] = [];
  let closed = false;
  let scriptedEval: unknown = [1, 60000];
  const client = {
    async connect() {
      if (closed) throw new Error('client closed');
    },
    async ping() {
      commands.push({ command: 'PING', args: [] });
      return 'PONG';
    },
    async send(command: string, args: string[]) {
      commands.push({ command, args });
      if (command === 'SET') values.set(args[0] ?? '', args[1] ?? '');
      if (command === 'EVAL') return scriptedEval;
      return 'OK';
    },
    async get(key: string) {
      commands.push({ command: 'GET', args: [key] });
      return values.get(key) ?? null;
    },
    async del(key: string) {
      commands.push({ command: 'DEL', args: [key] });
      return values.delete(key) ? 1 : 0;
    },
    async hgetall(key: string) {
      commands.push({ command: 'HGETALL', args: [key] });
      return hashes.get(key) ?? {};
    },
    close() {
      closed = true;
    },
  };
  return {
    client: client as never,
    scriptEval: (value: unknown) => {
      scriptedEval = value;
    },
    commands,
    values: () => values,
    hashes,
    isClosed: () => closed,
  };
}

const createTestRedis = (
  events: Array<{
    event: string;
    fields: Record<string, unknown>;
    message: string;
  }> = [],
  values?: Map<string, string>,
  hashes?: Map<string, Record<string, string>>,
) => {
  const fake = fakeRedis(values, hashes);
  const redis = createRedis({
    url: 'redis://127.0.0.1:1',
    namespace: 'test',
    eventSink: (event, fields, message) =>
      events.push({ event, fields, message }),
    client: fake.client,
  });
  return { redis, ...fake };
};

describe('redisKey', () => {
  test('namespace is explicit and unambiguous', () => {
    assert({
      given: 'a namespace, domain and segment',
      should: 'compose the versioned key',
      actual: redisKey('daisy', 'presence', 'user-1'),
      expected: 'daisy:v1:presence:user-1',
    });
    expect(() => redisKey('daisy', 'a:b')).toThrow();
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

    await expect(redis.get('key')).rejects.toThrow();

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
    ).rejects.toThrow();
    await expect(
      redis.consumeRateLimit('ok', { windowSeconds: 0, max: 3 }),
    ).rejects.toThrow();
    await expect(
      redis.consumeRateLimit('ok', { windowSeconds: 60, max: 0 }),
    ).rejects.toThrow();
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
    const redis = createRedis({
      url: 'redis://127.0.0.1:1',
      namespace: 'test',
      eventSink: (event, fields) => events.push({ event, fields }),
      client: {
        async connect() {
          throw new Error('offline');
        },
      } as never,
    });
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

describe('presence lease upsert', () => {
  test('runs one namespaced atomic EVAL scoring the conn, actor and online keys', async () => {
    const { redis, commands } = createTestRedis();
    await redis.upsertPresenceLease(
      { connId: 'conn1', actorId: 'actor1', instanceId: 'inst1', activity: 'active' },
      60,
      1_000,
    );
    const evals = commands.filter(({ command }) => command === 'EVAL');
    assert({
      given: 'a presence lease upsert',
      should: 'issue exactly one EVAL over three namespaced keys with the TTL and score',
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
        { connId: 'bad key!', actorId: 'actor1', instanceId: 'inst1', activity: 'active' },
        60,
        1_000,
      ),
    ).rejects.toThrow('Invalid connId');
    await expect(
      redis.upsertPresenceLease(
        { connId: 'conn1', actorId: 'actor1', instanceId: 'inst1', activity: 'active' },
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
    await redis.refreshPresenceLease({ connId: 'conn1', actorId: 'actor1' }, 60, 5_000);
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
      actual: await redis.refreshPresenceLease({ connId: 'conn1', actorId: 'actor1' }, 60, 5_000),
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
    const { redis, scriptEval, commands } = createTestRedis(undefined, undefined, hashes);
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
      given: 'a connId that survived the zset trim but whose hash TTL already fired',
      should: 'omit it from the live connections rather than returning partial data',
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
      actual: [online, commands.find(({ command }) => command === 'EVAL')?.args.slice(1)],
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
