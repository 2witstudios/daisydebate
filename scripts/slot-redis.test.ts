import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  deriveSlot,
  slotEnvValues,
  slotMismatches,
  worktreeSlot,
} from './slot-model';
import {
  clearTestNamespaces,
  configValue,
  expectedTestRedisDatabase,
  openOwnTestRedis,
  redisDatabaseRefusal,
  redisDatabasesNeeded,
  requireRedisDatabases,
  testRedisRefusal,
  testRedisRefusalOf,
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

  test('derives the slot’s own database from its PORT', () => {
    assert({
      given:
        'main (3000, or no PORT), worktree blocks 1, 11 and 499, and ports that name no block',
      should:
        'expect 1 for main and 2 + block for a worktree, and nothing for the rest',
      actual: [
        expectedTestRedisDatabase('3000'),
        expectedTestRedisDatabase(undefined),
        expectedTestRedisDatabase('13010'),
        expectedTestRedisDatabase('13110'),
        expectedTestRedisDatabase('17990'),
        expectedTestRedisDatabase('13000'),
        expectedTestRedisDatabase('13115'),
        expectedTestRedisDatabase('18000'),
        expectedTestRedisDatabase('abc'),
        expectedTestRedisDatabase('13110', 'main'),
      ],
      expected: [
        1,
        1,
        3,
        13,
        501,
        undefined,
        undefined,
        undefined,
        undefined,
        1,
      ],
    });
  });

  test('refuses every test Redis URL that is not exactly the slot’s own database', () => {
    const own = 13;
    const refusal = (url: string | undefined, expected: number | undefined) =>
      testRedisRefusal(url, expected);
    const wrong = (index: number | string) =>
      `TEST_REDIS_URL names Redis database ${index}, expected this slot's own database ${own} (run bun slot:up)`;

    assert({
      given:
        'a worktree on database 13 and URLs naming its own, another slot’s (5), dev (0, and by omission), e2e (2), main’s test (1), 512, a padded and a trailing-junk index',
      should: 'accept only exactly 13 and name the database of every other',
      actual: [
        refusal('redis://localhost:6379/13', own),
        refusal('redis://localhost:6379/5', own),
        refusal('redis://localhost:6379/0', own),
        refusal('redis://localhost:6379', own),
        refusal('redis://localhost:6379/2', own),
        refusal('redis://localhost:6379/1', own),
        refusal('redis://localhost:6379/512', own),
        refusal('redis://localhost:6379/013', own),
        refusal('redis://localhost:6379/13x', own),
      ],
      expected: [
        undefined,
        wrong(5),
        wrong(0),
        wrong(0),
        wrong(2),
        wrong(1),
        wrong(512),
        wrong('013'),
        wrong('13x'),
      ],
    });
    assert({
      given: 'the main slot (database 1) pointed at 0, 2, a worktree’s and 1',
      should: 'accept only database 1',
      actual: [
        refusal('redis://localhost:6379/1', 1),
        refusal('redis://localhost:6379/0', 1),
        refusal('redis://localhost:6379/2', 1),
        refusal('redis://localhost:6379/13', 1),
      ],
      expected: [
        undefined,
        "TEST_REDIS_URL names Redis database 0, expected this slot's own database 1 (run bun slot:up)",
        "TEST_REDIS_URL names Redis database 2, expected this slot's own database 1 (run bun slot:up)",
        "TEST_REDIS_URL names Redis database 13, expected this slot's own database 1 (run bun slot:up)",
      ],
    });
    assert({
      given: 'a slot whose PORT names no block, and no URL',
      should: 'refuse rather than guess, and say what is unset',
      actual: [
        refusal('redis://localhost:6379/13', undefined),
        refusal(undefined, own),
      ],
      expected: [
        "PORT does not name this slot's port block, so its test Redis database cannot be derived (run bun slot:up)",
        'TEST_REDIS_URL is unset',
      ],
    });
  });

  test('the runner’s guard reads TEST_REDIS_URL and PORT from the environment', () => {
    const env = (url: string, port: string | undefined) => ({
      TEST_REDIS_URL: url,
      PORT: port,
    });

    assert({
      given:
        'a worktree (PORT 13110) on its own database, on another slot’s, and on dev 0; main (no PORT, CI) on 1 and on 0',
      should: 'refuse every database that is not the slot’s own',
      actual: [
        testRedisRefusalOf(env('redis://h:6379/13', '13110')),
        testRedisRefusalOf(env('redis://h:6379/5', '13110')) !== undefined,
        testRedisRefusalOf(env('redis://h:6379/0', '13110')) !== undefined,
        testRedisRefusalOf(env('redis://h:6379/1', undefined)),
        testRedisRefusalOf(env('redis://h:6379/0', undefined)) !== undefined,
      ],
      expected: [undefined, true, true, undefined, true],
    });
  });

  test('a client is opened only on the worktree’s own database', () => {
    const opened = [
      ['redis://localhost:6379/13', '13110'],
      ['redis://localhost:6379/5', '13110'],
      ['redis://localhost:6379/0', '13110'],
      ['redis://localhost:6379/2', '13110'],
      ['redis://localhost:6379/512', '13110'],
      ['redis://localhost:6379/1', '13110'],
      ['redis://localhost:6379/13', '13115'],
      [undefined, '13110'],
    ].map(([url, port]) => openOwnTestRedis(url, port));

    assert({
      given:
        'its own database, another slot’s, dev, e2e, 512, main’s, a PORT that names no block, and no URL',
      should: 'open exactly one client, for the first',
      actual: opened.map((client) => client !== undefined),
      expected: [true, false, false, false, false, false, false, false],
    });
    for (const client of opened) client?.close();
  });

  test('doctor’s ownership check reports a test Redis that is not the slot’s own', () => {
    const slot = worktreeSlot('abc');
    const own = slotEnvValues({ slot, env, portBlock: 11 });
    const mismatches = (url: string) =>
      slotMismatches(slot, { ...own, TEST_REDIS_URL: url });
    const main = slotEnvValues({
      slot: deriveSlot({
        checkout: '/repo/daisy',
        mainCheckout: '/repo/daisy',
      }),
      env,
    });

    assert({
      given:
        'a worktree on its own database, another slot’s, dev and e2e; main on 1 and on 0',
      should: 'report every database that is not exactly the slot’s own',
      actual: [
        mismatches('redis://localhost:6379/13'),
        mismatches('redis://localhost:6379/5'),
        mismatches('redis://localhost:6379/0'),
        mismatches('redis://localhost:6379/2'),
        slotMismatches(
          deriveSlot({ checkout: '/repo/daisy', mainCheckout: '/repo/daisy' }),
          main,
        ),
        slotMismatches(
          deriveSlot({ checkout: '/repo/daisy', mainCheckout: '/repo/daisy' }),
          { ...main, TEST_REDIS_URL: 'redis://localhost:6379/0' },
        ),
      ],
      expected: [
        [],
        [
          "TEST_REDIS_URL names Redis database 5, expected this slot's own database 13 (run bun slot:up)",
        ],
        [
          "TEST_REDIS_URL names Redis database 0, expected this slot's own database 13 (run bun slot:up)",
        ],
        [
          "TEST_REDIS_URL names Redis database 2, expected this slot's own database 13 (run bun slot:up)",
        ],
        [],
        [
          "TEST_REDIS_URL names Redis database 0, expected this slot's own database 1 (run bun slot:up)",
        ],
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
    assert({
      given: 'no client (the URL named a database the slot does not own)',
      should: 'remove nothing',
      actual: await clearTestNamespaces(undefined),
      expected: 0,
    });
  });
});
