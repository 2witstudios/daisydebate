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
function fakeRedis(values: Map<string, string> = new Map()) {
  const commands: RecordedCommand[] = [];
  let closed = false;
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
    close() {
      closed = true;
    },
  };
  return {
    client: client as never,
    commands,
    values: () => values,
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
) => {
  const fake = fakeRedis(values);
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
