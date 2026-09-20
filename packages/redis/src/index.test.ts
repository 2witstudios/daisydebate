import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { redisKey } from './index';
import { createRedis } from './index';

setupRitewayBun();

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
