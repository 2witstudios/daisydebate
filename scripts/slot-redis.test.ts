import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { slotEnvValues, slotMismatches, worktreeSlot } from './slot-model';
import {
  clearTestNamespaces,
  configValue,
  openOwnTestRedis,
  redisDatabaseRefusal,
  redisDatabasesNeeded,
  requireRedisDatabases,
  testRedisDatabase,
} from './slot-redis';

setupRitewayBun();

const env = {
  DATABASE_URL: 'postgres://daisy:pw@localhost:15432/daisy',
  REDIS_URL: 'redis://localhost:6379',
};

describe('slot test Redis database (ISSUE-237)', () => {
  test('every worktree gets its own test Redis database, never a shared one', () => {
    const urlOf = (block: number) =>
      slotEnvValues({ slot: worktreeSlot('abc'), env, portBlock: block })
        .TEST_REDIS_URL;

    assert({
      given: 'the first, second and last port blocks',
      should:
        'select Redis database 2 + block: 3, 4 and 501, above dev (0), main test (1) and e2e (2)',
      actual: [urlOf(1), urlOf(2), urlOf(499)],
      expected: [
        'redis://localhost:6379/3',
        'redis://localhost:6379/4',
        'redis://localhost:6379/501',
      ],
    });
    assert({
      given: 'the last port block, and the main checkout',
      should:
        'need a server with at least 502 databases, and main keep database 1',
      actual: [
        testRedisDatabase(499),
        redisDatabasesNeeded(499),
        testRedisDatabase(),
      ],
      expected: [501, 502, 1],
    });
  });

  test('reads CONFIG GET replies in either protocol shape', () => {
    assert({
      given: 'a RESP3 map, a RESP2 list, a Map and an empty reply',
      should: 'find the databases value in each, and none in the last',
      actual: [
        configValue({ databases: '512' }, 'databases'),
        configValue(['databases', '16'], 'databases'),
        configValue(new Map([['databases', '64']]), 'databases'),
        configValue([], 'databases'),
        configValue({}, 'databases'),
      ],
      expected: ['512', '16', '64', undefined, undefined],
    });
  });

  test('a Redis with too few databases is refused with the operator step', () => {
    const refusal = redisDatabaseRefusal({ available: 16, block: 14 });

    assert({
      given:
        'a 16-database Redis: block 13 needs database 15, block 14 needs 16; and a 512-database Redis for the last block',
      should: 'accept what fits and refuse what does not',
      actual: [
        redisDatabaseRefusal({ available: 16, block: 13 }),
        refusal === undefined,
        redisDatabaseRefusal({ available: 512, block: 499 }),
        redisDatabaseRefusal({ available: 16 }),
      ],
      expected: [undefined, false, undefined, undefined],
    });
    assert({
      given: 'the refusal for block 14 on 16 databases',
      should: 'name the database it needs and the one-time recreate command',
      actual: [
        refusal?.includes('offers 16 databases'),
        refusal?.includes('test database is 16'),
        refusal?.includes('up -d --force-recreate redis'),
      ],
      expected: [true, true, true],
    });
  });

  test('asks the server before a slot is written', async () => {
    const reply = (databases: string) => ({
      send: async () => ({ databases }),
    });

    const outcomes = await Promise.all(
      [
        requireRedisDatabases(reply('16'), 13),
        requireRedisDatabases(reply('16'), 14),
        requireRedisDatabases({ send: async () => ({}) }, 1),
      ].map((attempt) =>
        attempt.then(
          () => 'ok',
          (error: Error) => error.message.slice(0, 26),
        ),
      ),
    );

    assert({
      given:
        'a 16-database server for blocks 13 and 14, and a reply with no databases value',
      should: 'accept block 13 and refuse block 14 and the unreadable reply',
      actual: outcomes,
      expected: [
        'ok',
        'The shared Redis offers 16',
        'The shared Redis offers 0 ',
      ],
    });
  });

  test('flags a worktree whose test Redis is one of the shared databases', () => {
    const slot = worktreeSlot('abc');
    const own = slotEnvValues({ slot, env, portBlock: 1 });

    assert({
      given:
        'a .env still on the old shared test Redis database 1, and one on its own',
      should: 'name only the shared one',
      actual: [
        slotMismatches(slot, {
          ...own,
          TEST_REDIS_URL: 'redis://localhost:6379/1',
        }),
        slotMismatches(slot, own),
      ],
      expected: [
        [
          "TEST_REDIS_URL uses shared Redis database 1, expected this slot's own database (3 or higher; run bun slot:up)",
        ],
        [],
      ],
    });
  });

  test('slot:down clears every t3- namespace and nothing else', async () => {
    const keys = new Set([
      't3-a:v1:x',
      't3-a:v1:y',
      't3-b:v1:x',
      'daisy-wt-abc:v1:session',
    ]);
    const client = {
      send: async (command: string, args: string[]) => {
        if (command === 'SCAN') {
          const prefix = (args[args.indexOf('MATCH') + 1] ?? '').replace(
            /\*$/,
            '',
          );
          return ['0', [...keys].filter((key) => key.startsWith(prefix))];
        }
        return args.filter((key) => keys.delete(key)).length;
      },
    };

    const removed = await clearTestNamespaces(client);

    assert({
      given: 'two test namespaces with three keys and a dev namespace key',
      should: 'remove the three test keys and keep the dev key',
      actual: { removed, left: [...keys] },
      expected: { removed: 3, left: ['daisy-wt-abc:v1:session'] },
    });
  });

  test('only a database the worktree owns is ever cleared', () => {
    const opened = [
      'redis://localhost:6379/1',
      'redis://localhost:6379',
      'redis://localhost:6379/2',
      'redis://localhost:6379/13',
      undefined,
    ].map(openOwnTestRedis);

    assert({
      given:
        'a worktree still on the shared database 1 (or 0, 2), one on its own database, and no URL',
      should: 'open a client only for the worktree’s own database',
      actual: opened.map((client) => client !== undefined),
      expected: [false, false, false, true, false],
    });
    for (const client of opened) client?.close();
  });
});
