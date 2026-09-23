import { expect } from 'bun:test';
import { RedisClient } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { deleteNamespace, listNamespaces } from '../src/namespaces';
import { requireTestServices } from '@daisy/config';

setupRitewayBun();

const { redisUrl: url } = requireTestServices(process.env);

const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
  byte.toString(16).padStart(2, '0'),
).join('');
// A unique prefix: these tests only ever see and delete their own keys.
const prefix = `nsit${suffix}`;

/** The real client, recording every command so the test can audit them. */
const recordingClient = () => {
  const client = new RedisClient(url);
  const commands: string[] = [];
  return {
    commands,
    client,
    send: (command: string, args: string[]) => {
      commands.push(command.toUpperCase());
      return client.send(command, args);
    },
  };
};

test('deletes exactly one namespace by SCAN and UNLINK, never FLUSH*', async () => {
  const redis = recordingClient();
  const keys = {
    target: [`${prefix}-wt-a:v1:x`, `${prefix}-wt-a:v1:y`],
    // Shares the textual prefix `<p>-wt-a` but is another namespace.
    sibling: [`${prefix}-wt-ab:v1:x`, `${prefix}-wt-a-e2e:v1:x`],
    main: [`${prefix}:v1:x`],
  };
  try {
    // More keys than one SCAN page, so the cursor loop is exercised. Issued
    // together so Bun pipelines them instead of paying one round trip each.
    const bulk = Array.from(
      { length: 1200 },
      (_, index) => `${prefix}-wt-a:v1:bulk${index}`,
    );
    await Promise.all(
      [...keys.target, ...keys.sibling, ...keys.main, ...bulk].map((key) =>
        redis.client.send('SET', [key, '1', 'EX', '60']),
      ),
    );

    assert({
      given: 'keys in a namespace, a textual-prefix sibling and its e2e twin',
      should: 'list each distinct namespace under the prefix',
      actual: await listNamespaces(redis, `${prefix}-wt-`),
      expected: [`${prefix}-wt-a`, `${prefix}-wt-a-e2e`, `${prefix}-wt-ab`],
    });
    assert({
      given: 'a namespace with more keys than one SCAN page',
      should: 'delete every one of its keys',
      actual: await deleteNamespace(redis, `${prefix}-wt-a`),
      expected: 1202,
    });

    const remaining = await Promise.all(
      [...keys.target, ...keys.sibling, ...keys.main].map(async (key) => [
        key,
        await redis.client.exists(key),
      ]),
    );
    assert({
      given: 'the namespace deleted',
      should: 'keep sibling, e2e and main namespace keys',
      actual: Object.fromEntries(remaining),
      expected: {
        [keys.target[0]!]: false,
        [keys.target[1]!]: false,
        [keys.sibling[0]!]: true,
        [keys.sibling[1]!]: true,
        [keys.main[0]!]: true,
      },
    });
    assert({
      given: 'every command the deletion issued',
      should: 'use UNLINK and never FLUSHDB or FLUSHALL',
      actual: {
        flush: redis.commands.filter((command) => command.startsWith('FLUSH')),
        unlink: redis.commands.includes('UNLINK'),
      },
      expected: { flush: [], unlink: true },
    });
  } finally {
    for (const namespace of [
      `${prefix}-wt-a`,
      `${prefix}-wt-ab`,
      `${prefix}-wt-a-e2e`,
      prefix,
    ])
      await deleteNamespace(redis, namespace);
    redis.client.close();
  }
});

test('refuses namespaces and prefixes that could widen the match', async () => {
  const redis = recordingClient();
  try {
    for (const hostile of [
      '*',
      'a*',
      'a?',
      'a[b]',
      'A',
      '',
      'a:b',
      `a${'b'.repeat(41)}`,
    ]) {
      await expect(deleteNamespace(redis, hostile)).rejects.toThrow(
        /namespace/,
      );
      await expect(listNamespaces(redis, hostile)).rejects.toThrow(/namespace/);
    }
    assert({
      given: 'hostile namespaces and prefixes',
      should: 'reject them before sending any command',
      actual: redis.commands,
      expected: [],
    });
  } finally {
    redis.client.close();
  }
});
