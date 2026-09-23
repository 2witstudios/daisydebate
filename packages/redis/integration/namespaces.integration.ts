import { expect, test } from 'bun:test';
import { RedisClient } from 'bun';
import { deleteNamespace, listNamespaces } from '../src/namespaces';
const url = process.env.TEST_REDIS_URL;
if (!url) throw new Error('TEST_REDIS_URL required');

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
    for (const key of [...keys.target, ...keys.sibling, ...keys.main])
      await redis.client.send('SET', [key, '1', 'EX', '60']);
    // More keys than one SCAN page, so the cursor loop is exercised.
    for (let index = 0; index < 1200; index += 1)
      await redis.client.send('SET', [
        `${prefix}-wt-a:v1:bulk${index}`,
        '1',
        'EX',
        '60',
      ]);

    expect(await listNamespaces(redis, `${prefix}-wt-`)).toEqual([
      `${prefix}-wt-a`,
      `${prefix}-wt-a-e2e`,
      `${prefix}-wt-ab`,
    ]);
    expect(await deleteNamespace(redis, `${prefix}-wt-a`)).toBe(1202);

    const remaining = await Promise.all(
      [...keys.target, ...keys.sibling, ...keys.main].map(async (key) => [
        key,
        await redis.client.exists(key),
      ]),
    );
    expect(Object.fromEntries(remaining)).toEqual({
      [keys.target[0]!]: false,
      [keys.target[1]!]: false,
      [keys.sibling[0]!]: true,
      [keys.sibling[1]!]: true,
      [keys.main[0]!]: true,
    });
    expect(
      redis.commands.filter((command) => command.startsWith('FLUSH')),
    ).toEqual([]);
    expect(redis.commands.includes('UNLINK')).toBe(true);
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
    expect(redis.commands).toEqual([]);
  } finally {
    redis.client.close();
  }
});
