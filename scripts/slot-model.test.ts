import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  deriveSlot,
  findOrphans,
  liveWorktreeIds,
  parsePortBlockComment,
  parseWorktreeList,
  pickPortBlock,
  portBlockComment,
  readEnvValue,
  rewriteEnv,
  slotEnvValues,
  slotMismatches,
  worktreeSlot,
} from './slot-model';

setupRitewayBun();

const main = '/repo/daisy';
const redisNamespaceRule = /^[a-z][a-z0-9-]{0,40}$/;
const postgresIdentifierRule = /^[a-z_][a-z0-9_]{0,62}$/;

describe('slot derivation', () => {
  test('the main checkout is slot daisy', () => {
    assert({
      given: 'the main checkout',
      should: 'keep the canonical database names and namespace',
      actual: deriveSlot({ checkout: main, mainCheckout: main }),
      expected: {
        kind: 'main',
        id: 'daisy',
        database: 'daisy',
        testDatabase: 'daisy_test',
        namespace: 'daisy',
        e2eNamespace: 'daisy-e2e',
      },
    });
  });

  test('a pu worktree folder maps to its own databases and namespace', () => {
    assert({
      given: 'a worktree folder named wt-3ctbm0tw',
      should: 'derive daisy_wt_<id> names and a hyphenated namespace',
      actual: deriveSlot({
        checkout: '/repo/daisy/.pu/worktrees/wt-3ctbm0tw',
        mainCheckout: main,
      }),
      expected: {
        kind: 'worktree',
        id: '3ctbm0tw',
        database: 'daisy_wt_3ctbm0tw',
        testDatabase: 'daisy_wt_3ctbm0tw_test',
        namespace: 'daisy-wt-3ctbm0tw',
        e2eNamespace: 'daisy-wt-3ctbm0tw-e2e',
      },
    });
  });

  test('normalises case and separators of an ordinary folder name', () => {
    assert({
      given: 'a worktree folder named Feature-Login',
      should: 'lowercase it and use underscores in Postgres, hyphens in Redis',
      actual: [
        deriveSlot({ checkout: '/elsewhere/Feature-Login', mainCheckout: main })
          .database,
        worktreeSlot('feature_login').namespace,
      ],
      expected: ['daisy_wt_feature_login', 'daisy-wt-feature-login'],
    });
  });

  test('every derived identifier satisfies Postgres and REDIS_NAMESPACE', () => {
    const slot = deriveSlot({
      checkout: `/w/wt-${'a'.repeat(28)}`,
      mainCheckout: main,
    });
    assert({
      given: 'the longest accepted worktree id',
      should: 'produce valid identifiers for every name',
      actual: [
        postgresIdentifierRule.test(slot.database),
        postgresIdentifierRule.test(slot.testDatabase),
        redisNamespaceRule.test(slot.namespace),
        redisNamespaceRule.test(slot.e2eNamespace),
      ],
      expected: [true, true, true, true],
    });
  });

  test('rejects hostile and unrepresentable folder names', () => {
    for (const folder of [
      'wt-"; DROP DATABASE daisy; --',
      "wt-a'b",
      'wt-a b',
      'wt-a.b',
      'wt-a*',
      'wt-a:b',
      'wt-',
      'wt-_a',
      'wt-a__b',
      'wt-a-',
      'wt-ünïcode',
      `wt-${'a'.repeat(29)}`,
      'wt-a-test',
      'wt-a-e2e',
    ])
      expect(() =>
        deriveSlot({ checkout: `/w/${folder}`, mainCheckout: main }),
      ).toThrow(/worktree folder/);
  });
});

describe('git worktree list parsing', () => {
  const porcelain = [
    'worktree /repo/daisy',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/main',
    '',
    'worktree /repo/daisy/.pu/worktrees/wt-aaaa1111',
    'HEAD 2222222222222222222222222222222222222222',
    'branch refs/heads/pu/a',
    '',
    'worktree /repo/daisy/.pu/worktrees/wt-bbbb2222',
    'HEAD 3333333333333333333333333333333333333333',
    'detached',
    'prunable gitdir file points to non-existent location',
    '',
    'worktree /repo/daisy/.pu/worktrees/wt-cccc3333',
    'HEAD 4444444444444444444444444444444444444444',
    'locked',
    '',
  ].join('\n');

  test('names the main checkout and every live worktree', () => {
    assert({
      given: 'porcelain output with a prunable (folder deleted) entry',
      should: 'treat the prunable entry as removed',
      actual: parseWorktreeList(porcelain),
      expected: {
        main: '/repo/daisy',
        worktrees: [
          '/repo/daisy/.pu/worktrees/wt-aaaa1111',
          '/repo/daisy/.pu/worktrees/wt-cccc3333',
        ],
      },
    });
  });

  test('derives live worktree ids and refuses colliding folders', () => {
    assert({
      given: 'two live worktrees',
      should: 'list their slot ids',
      actual: liveWorktreeIds(['/x/wt-aaaa1111', '/y/feature-b']),
      expected: { ids: ['aaaa1111', 'feature_b'], unslotted: [] },
    });
    assert({
      given: 'a live worktree whose folder cannot be a slot',
      should: 'report it rather than guess an id',
      actual: liveWorktreeIds(['/x/wt-aaaa1111', '/x/bad.name']),
      expected: { ids: ['aaaa1111'], unslotted: ['/x/bad.name'] },
    });
    expect(() => liveWorktreeIds(['/x/wt-feature-b', '/y/feature_b'])).toThrow(
      /same slot/,
    );
  });
});

describe('orphan detection', () => {
  test('selects only slots whose worktree is gone', () => {
    assert({
      given: 'databases and namespaces of live, removed and main slots',
      should: 'drop only the removed slot and never main or unknown names',
      actual: findOrphans({
        liveIds: ['live1', 'live1_x'],
        databases: [
          'daisy',
          'daisy_test',
          'daisy_template',
          'daisy_wt_live1',
          'daisy_wt_live1_test',
          'daisy_wt_live1_x',
          'daisy_wt_gone',
          'daisy_wt_gone_test',
          'daisy_wt_Bad',
          'postgres',
        ],
        namespaces: [
          'daisy',
          'daisy-e2e',
          'daisy-wt-live1',
          'daisy-wt-live1-e2e',
          'daisy-wt-live1-x',
          'daisy-wt-gone',
          'daisy-wt-gone-e2e',
          'daisy-wt-',
        ],
      }),
      expected: {
        ids: ['gone'],
        databases: ['daisy_wt_gone', 'daisy_wt_gone_test'],
        namespaces: ['daisy-wt-gone', 'daisy-wt-gone-e2e'],
      },
    });
  });
});

describe('.env ownership check', () => {
  const slot = worktreeSlot('abc');
  const own = slotEnvValues({
    slot,
    env: {
      DATABASE_URL: 'postgres://daisy:pw@localhost:15432/daisy',
      REDIS_URL: 'redis://localhost:6379',
    },
    portBlock: 1,
  });

  test('accepts a .env written for this slot', () => {
    assert({
      given: 'values slot:up wrote for this worktree',
      should: 'report no mismatch',
      actual: slotMismatches(slot, own),
      expected: [],
    });
  });

  test('names every value that points at another slot', () => {
    assert({
      given: 'a .env copied from the main checkout',
      should: 'name each mismatched variable and the expected value',
      actual: slotMismatches(slot, {
        DATABASE_URL: 'postgres://daisy:pw@localhost:15432/daisy',
        TEST_DATABASE_URL: 'postgres://daisy:pw@localhost:15432/daisy_test',
        REDIS_NAMESPACE: 'daisy',
        E2E_DATABASE_URL: own.E2E_DATABASE_URL,
      }),
      expected: [
        'DATABASE_URL names "daisy", expected "daisy_wt_abc"',
        'TEST_DATABASE_URL names "daisy_test", expected "daisy_wt_abc_test"',
        'REDIS_NAMESPACE names "daisy", expected "daisy-wt-abc"',
        'E2E_REDIS_NAMESPACE is unset, expected "daisy-wt-abc-e2e"',
      ],
    });
  });
});

describe('slot .env values', () => {
  const env = {
    DATABASE_URL:
      'postgres://daisy:local-development-only@localhost:15432/daisy',
    TEST_DATABASE_URL:
      'postgres://daisy:local-development-only@localhost:15432/daisy_test',
    REDIS_URL: 'redis://localhost:6379',
  };

  test('main keeps the canonical values and ports', () => {
    assert({
      given: 'the main slot',
      should: 'write the canonical database URLs, namespaces and ports',
      actual: slotEnvValues({
        slot: deriveSlot({ checkout: main, mainCheckout: main }),
        env,
      }),
      expected: {
        DATABASE_URL:
          'postgres://daisy:local-development-only@localhost:15432/daisy',
        TEST_DATABASE_URL:
          'postgres://daisy:local-development-only@localhost:15432/daisy_test',
        REDIS_NAMESPACE: 'daisy',
        E2E_DATABASE_URL:
          'postgres://daisy_e2e:e2e-loopback-only@localhost:15432/daisy_test',
        E2E_REDIS_URL: 'redis://localhost:6379/2',
        E2E_REDIS_NAMESPACE: 'daisy-e2e',
        PORT: '3000',
        PUBLIC_APP_URL: 'http://localhost:3000',
        E2E_PORT: '3100',
      },
    });
  });

  test('a worktree keeps the server and moves database, namespace and ports', () => {
    assert({
      given: 'a worktree slot on port block 2 and a scratch server',
      should: 'keep host, port and credentials and replace only slot values',
      actual: slotEnvValues({
        slot: worktreeSlot('abc'),
        env: {
          DATABASE_URL: 'postgres://daisy:pw@127.0.0.1:35432/daisy',
          REDIS_URL: 'redis://127.0.0.1:36379',
        },
        portBlock: 2,
      }),
      expected: {
        DATABASE_URL: 'postgres://daisy:pw@127.0.0.1:35432/daisy_wt_abc',
        TEST_DATABASE_URL:
          'postgres://daisy:pw@127.0.0.1:35432/daisy_wt_abc_test',
        REDIS_NAMESPACE: 'daisy-wt-abc',
        E2E_DATABASE_URL:
          'postgres://daisy_e2e:e2e-loopback-only@127.0.0.1:35432/daisy_wt_abc_test',
        E2E_REDIS_URL: 'redis://127.0.0.1:36379/2',
        E2E_REDIS_NAMESPACE: 'daisy-wt-abc-e2e',
        PORT: '13020',
        PUBLIC_APP_URL: 'http://localhost:13020',
        E2E_PORT: '13021',
      },
    });
  });

  test('a worktree without a port block is refused', () => {
    expect(() => slotEnvValues({ slot: worktreeSlot('abc'), env })).toThrow(
      /port block/,
    );
  });
});

describe('.env rewriting', () => {
  test('replaces canonical assignments, appends missing keys, keeps the rest', () => {
    const content =
      '# comment\nDATABASE_URL=postgres://old/daisy\nSECRET=keep\nDATABASE_URL=postgres://dup/daisy\n';
    const result = rewriteEnv(content, {
      DATABASE_URL: 'postgres://new/daisy_wt_a',
      PORT: '13010',
    });
    assert({
      given: 'a .env with a duplicated key and a missing key',
      should: 'rewrite every assignment of the key and append the missing one',
      actual: result,
      expected: {
        changed: true,
        content:
          '# comment\nDATABASE_URL=postgres://new/daisy_wt_a\nSECRET=keep\nDATABASE_URL=postgres://new/daisy_wt_a\nPORT=13010\n',
      },
    });
  });

  test('is a no-op when every value already matches', () => {
    const content = 'PORT=13010\nSECRET=keep';
    assert({
      given: 'a .env already holding the slot values',
      should: 'report no change and return identical content',
      actual: rewriteEnv(content, { PORT: '13010' }),
      expected: { changed: false, content },
    });
  });

  test('reads the effective (last) assignment of a key', () => {
    assert({
      given: 'a .env with two assignments of a key',
      should: 'return the last value, or undefined when absent',
      actual: [
        readEnvValue('A=1\nB=2\nA=3\n', 'A'),
        readEnvValue('A=1\n', 'B'),
      ],
      expected: ['3', undefined],
    });
  });
});

describe('port blocks', () => {
  test('keeps an existing claim and otherwise takes the lowest free block', () => {
    assert({
      given: 'claims by other slots and one busy block',
      should: 'reuse the own claim, else skip claimed and busy blocks',
      actual: [
        pickPortBlock({ own: 7, claimed: [1, 2], isFree: () => false }),
        pickPortBlock({ claimed: [1, 2], isFree: (block) => block !== 3 }),
      ],
      expected: [7, 4],
    });
  });

  test('round-trips the claim stored on the slot database', () => {
    assert({
      given: 'a port block comment and foreign comments',
      should: 'parse only the exact claim format',
      actual: [
        parsePortBlockComment(portBlockComment(12)),
        parsePortBlockComment('daisy-slot port-block=12; drop'),
        parsePortBlockComment(null),
      ],
      expected: [12, undefined, undefined],
    });
    expect(() => portBlockComment(0)).toThrow(/port block/);
  });
});
