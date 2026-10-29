import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { partitionSuites, selectShard } from './integration-shards';
import timings from './integration-timings.json';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

setupRitewayBun();

describe('isolated integration shards', () => {
  test('balances expensive suites before filling spare capacity', () => {
    assert({
      given: 'four suites taking eight, seven, three and two seconds',
      should: 'put ten seconds of work on each worker',
      actual: partitionSuites(['d', 'b', 'a', 'c'], 2, {
        a: 8000,
        b: 7000,
        c: 3000,
        d: 2000,
      }),
      expected: [
        ['a', 'd'],
        ['b', 'c'],
      ],
    });
  });

  test('includes unmeasured suites and is independent of discovery order', () => {
    const files = ['c', 'a', 'b', 'new'];
    const shards = partitionSuites(files, 4, { a: 5000 });
    assert({
      given: 'new suites without timings and reversed filesystem discovery',
      should:
        'assign every suite exactly once with the same deterministic plan',
      actual: {
        coverage: shards.flat().sort(),
        reversed: partitionSuites([...files].reverse(), 4, { a: 5000 }),
      },
      expected: { coverage: [...files].sort(), reversed: shards },
    });
  });

  test('preserves local selection and permits empty partitions of small workspaces', () => {
    assert({
      given:
        'an unsharded selected suite and a workspace smaller than the worker pool',
      should: 'preserve local input and give the extra worker no work',
      actual: [selectShard(['b', 'a']), selectShard(['a'], '4/4')],
      expected: [['b', 'a'], []],
    });
  });

  test('rejects malformed selection rather than silently dropping coverage', () => {
    for (const selector of [
      '',
      '0/4',
      '5/4',
      '1/0',
      '1/2.5',
      '1',
      '1/4/2',
      ' 1/4',
      '1/65',
    ]) {
      let message = '';
      try {
        selectShard(['a'], selector);
      } catch (error) {
        message = (error as Error).message;
      }
      assert({
        given: `invalid shard selector ${JSON.stringify(selector)}`,
        should: 'refuse before executing tests',
        actual: message,
        expected:
          'Integration shard must be INDEX/COUNT with 1 <= INDEX <= COUNT <= 64',
      });
    }
  });

  test('partitions the entire current inventory without omissions or duplicates', () => {
    const files = [
      ...new Bun.Glob(
        '{apps,packages}/*/integration/**/*.integration.{ts,tsx}',
      ).scanSync('.'),
    ].sort();
    const workspaces = [
      ...new Set(files.map((file) => file.split('/').slice(0, 2).join('/'))),
    ];
    const shards = Array.from({ length: 4 }, (_, index) =>
      workspaces.flatMap((workspace) =>
        selectShard(
          files.filter((file) => file.startsWith(`${workspace}/`)),
          `${index + 1}/4`,
          timings.durationsMs,
        ),
      ),
    );
    assert({
      given: 'every real integration file, including newly added suites',
      should: 'cover the whole inventory exactly once',
      actual: {
        files: shards.flat().sort(),
        nonempty: shards.every((shard) => shard.length > 0),
      },
      expected: { files, nonempty: true },
    });
  });

  test('refuses filters and malformed shards before opening services', () => {
    for (const [selector, args, expected] of [
      ['0/4', [], 'Integration shard must be INDEX/COUNT'],
      [
        '1/4',
        ['--test-name-pattern', 'only one'],
        'Cannot combine integration sharding with test arguments',
      ],
    ] as const) {
      const result = Bun.spawnSync(
        ['bun', '../../scripts/test-integration.ts', ...args],
        {
          cwd: 'apps/web',
          env: {
            ...process.env,
            DAISY_INTEGRATION_SHARD: selector,
            TEST_DATABASE_URL: '',
            TEST_REDIS_URL: '',
          },
        },
      );
      assert({
        given: `a sharded runner with ${selector} and ${args.join(' ')}, without services`,
        should: 'fail on selection before attempting service configuration',
        actual: {
          refused: result.exitCode !== 0,
          reason: result.stderr.toString().includes(expected),
        },
        expected: { refused: true, reason: true },
      });
    }
  });

  test('Turbo forwards the shard and receipt directory to the real runner', () => {
    const directory = mkdtempSync(join(tmpdir(), 'daisy-shard-'));
    try {
      // This workspace has one suite. Its fourth partition must finish without
      // services; a stripped selector would instead attempt the full run.
      const result = Bun.spawnSync(
        [
          'bun',
          'run',
          'turbo',
          'run',
          'test:integration',
          '--filter=@daisy/log-shipper',
          '--concurrency=1',
        ],
        {
          env: {
            ...process.env,
            DAISY_INTEGRATION_SHARD: '4/4',
            DAISY_INTEGRATION_RECEIPTS: directory,
            TEST_DATABASE_URL: '',
            TEST_REDIS_URL: '',
          },
        },
      );
      const names = readdirSync(directory);
      const receipt =
        names.length === 1
          ? JSON.parse(readFileSync(join(directory, names[0]), 'utf8'))
          : {};
      assert({
        given:
          'strict Turbo environment, the actual runner, and an empty workspace partition',
        should:
          'record no work without opening services or falling back to bare bun test',
        actual: {
          code: result.exitCode,
          count: names.length,
          workspace: receipt.workspace,
          shard: receipt.shard,
          files: receipt.files,
        },
        expected: {
          code: 0,
          count: 1,
          workspace: 'apps/log-shipper',
          shard: '4/4',
          files: [],
        },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('an empty discovered inventory is an error, not an empty shard', () => {
    const directory = mkdtempSync(join(tmpdir(), 'daisy-no-suites-'));
    try {
      const result = Bun.spawnSync(
        ['bun', resolve('scripts/test-integration.ts')],
        {
          cwd: directory,
          env: {
            ...process.env,
            DAISY_INTEGRATION_SHARD: '4/4',
            TEST_DATABASE_URL: '',
            TEST_REDIS_URL: '',
          },
        },
      );
      assert({
        given:
          'a valid shard selector in a workspace with no discovered suites',
        should: 'refuse before services instead of reporting success',
        actual: {
          code: result.exitCode,
          reason: result.stderr
            .toString()
            .includes('no suites under integration/'),
        },
        expected: { code: 1, reason: true },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
