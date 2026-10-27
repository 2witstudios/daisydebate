import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseBaseRef, partitionAffected, planGates } from './check-affected';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

setupRitewayBun();

describe('partitionAffected', () => {
  test('scopes eslint and prettier to eligible changed files', () => {
    const plan = partitionAffected([
      'apps/web/src/features/foundation/operations.ts',
      'README.md',
      'docs/development/local-development.md',
    ]);
    assert({
      given: 'mixed code and docs changes',
      should: 'lint only code files and prettier-check all',
      actual: {
        lintFiles: plan.lintFiles,
        prettierFiles: plan.prettierFiles.length,
      },
      expected: {
        lintFiles: ['apps/web/src/features/foundation/operations.ts'],
        prettierFiles: 3,
      },
    });
  });

  test('runs turbo only when workspace files change', () => {
    assert({
      given: 'only docs changes',
      should: 'skip the turbo affected gate',
      actual: partitionAffected(['docs/development/testing.md']).runTurbo,
      expected: false,
    });
    assert({
      given: 'a package source change',
      should: 'run the turbo affected gate',
      actual: partitionAffected(['packages/protocol/src/index.ts']).runTurbo,
      expected: true,
    });
  });

  test('excludes deleted files from lint and prettier but keeps workspace selection', () => {
    const plan = partitionAffected(
      [
        'packages/protocol/src/gone.ts',
        'apps/web/src/features/kept.ts',
        'docs/removed.md',
      ],
      ['packages/protocol/src/gone.ts', 'docs/removed.md'],
    );
    assert({
      given: 'a mix of existing and deleted files',
      should: 'drop only nonexistent files from the file-based gates',
      actual: {
        lintFiles: plan.lintFiles,
        prettierFiles: plan.prettierFiles,
        runTurbo: plan.runTurbo,
      },
      expected: {
        lintFiles: ['apps/web/src/features/kept.ts'],
        prettierFiles: ['apps/web/src/features/kept.ts'],
        runTurbo: true,
      },
    });
  });

  test('root script changes run the root script tests', () => {
    assert({
      given: 'a change under scripts/',
      should: 'run the root script test suite',
      actual: partitionAffected(['scripts/doctor.ts']).runRootScriptsTests,
      expected: true,
    });
  });

  test('eslint config changes run the config tests', () => {
    assert({
      given: 'a change to eslint.config.mjs',
      should: 'run the eslint config test suite',
      actual: partitionAffected(['eslint.config.mjs']).runEslintConfigTest,
      expected: true,
    });
  });
});

describe('planGates', () => {
  test('always includes the repo-wide boundaries and styling gates', () => {
    assert({
      given: 'no changed files',
      should: 'still verify architecture boundaries and styling',
      actual: planGates(partitionAffected([]), 'sha0'),
      expected: [
        { name: 'boundaries', args: ['bun', 'scripts/check-boundaries.ts'] },
        { name: 'styling', args: ['bun', 'scripts/check-styling.ts'] },
      ],
    });
  });

  test('turbo gate filters to the affected graph since the merge base', () => {
    const gates = planGates(
      partitionAffected(['packages/protocol/src/index.ts']),
      'abc123',
    );
    const turbo = gates.find(({ name }) => name.startsWith('turbo'));
    assert({
      given: 'a package change and a merge base',
      should: 'filter turbo to affected packages and dependents',
      actual: turbo?.args.slice(-2),
      expected: ['--filter', '...[abc123]'],
    });
  });

  test('deletion-only changes skip the eslint and prettier gates', () => {
    const gates = planGates(
      partitionAffected(
        ['packages/protocol/src/gone.ts'],
        ['packages/protocol/src/gone.ts'],
      ),
      'abc123',
    );
    assert({
      given: 'only a deleted workspace file',
      should: 'run the repo-wide gates and turbo without file-based gates',
      actual: gates.map(({ name }) => name),
      expected: ['boundaries', 'styling', 'turbo affected (typecheck, test)'],
    });
  });
});

describe('parseBaseRef', () => {
  test('defaults to origin/main when only flags are passed', () => {
    assert({
      given: 'argv containing only a --json flag',
      should: 'keep the default base ref',
      actual: parseBaseRef(['bun', 'scripts/check-affected.ts', '--json']),
      expected: 'origin/main',
    });
  });

  test('uses the first positional argument as the base ref', () => {
    assert({
      given: 'a positional ref followed by a flag',
      should: 'select the positional ref',
      actual: parseBaseRef([
        'bun',
        'scripts/check-affected.ts',
        '--json',
        'origin/develop',
      ]),
      expected: 'origin/develop',
    });
  });
});

describe('global affected fanout', () => {
  test('root configuration and global dependencies select every workspace', () => {
    for (const file of [
      'bun.lock',
      'package.json',
      'turbo.json',
      '.bun-version',
      'eslint.config.mjs',
      'packages/typescript-config/base.json',
    ]) {
      const gates = planGates(partitionAffected([file]), 'base');
      assert({
        given: file,
        should: 'run unfiltered workspace typechecks and tests',
        actual: gates
          .find(({ name }) => name.startsWith('turbo'))
          ?.args.includes('--filter'),
        expected: false,
      });
    }
  });
  test('reports stay out of the quick check', () => {
    assert({
      given: 'a leaf edit',
      should: 'leave knip and duplication to the advisory reports',
      actual: planGates(partitionAffected(['apps/web/src/a.ts']), 'base').some(
        ({ name }) => name === 'knip' || name === 'duplication',
      ),
      expected: false,
    });
  });
});

describe('affectedLintDirectories', () => {
  test('lints source alongside config-only and ignored affected workspaces', async () => {
    const { affectedLintDirectories } = await import('./check-affected');
    const fixture = mkdtempSync(join(tmpdir(), 'daisy-affected-eslint-'));
    try {
      for (const workspace of ['typescript-config', 'source', 'ignored'])
        mkdirSync(join(fixture, 'packages', workspace), { recursive: true });
      writeFileSync(
        join(fixture, 'packages/typescript-config/base.json'),
        '{}',
      );
      writeFileSync(join(fixture, 'packages/source/index.js'), 'export {};');
      writeFileSync(join(fixture, 'packages/ignored/index.js'), 'debugger;');
      writeFileSync(
        join(fixture, 'eslint.config.mjs'),
        "export default [{ ignores: ['packages/ignored/**'] }, { files: ['**/*.js'], rules: { 'no-debugger': 'error' } }];",
      );
      const directories = affectedLintDirectories({
        tasks: ['typescript-config', 'source', 'ignored'].map((workspace) => ({
          directory: `packages/${workspace}`,
        })),
      });
      const lint = planGates(
        {
          ...partitionAffected(['packages/source/index.js']),
          lintFiles: directories,
        },
        'base',
      ).find(({ name }) => name.startsWith('eslint'));
      if (!lint) throw new Error('Missing affected source lint gate');
      const run = () =>
        Bun.spawnSync(
          [
            process.execPath,
            join(import.meta.dir, '../node_modules/eslint/bin/eslint.js'),
            ...lint.args.slice(3),
            '--format',
            'json',
          ],
          { cwd: fixture, stdout: 'pipe', stderr: 'pipe' },
        );
      const clean = run();
      assert({
        given:
          'config-only and globally ignored workspaces in the affected graph',
        should: 'finish linting the eligible source without pattern errors',
        actual: { exitCode: clean.exitCode, stderr: clean.stderr.toString() },
        expected: { exitCode: 0, stderr: '' },
      });
      writeFileSync(join(fixture, 'packages/source/index.js'), 'debugger;');
      const failed = run();
      assert({
        given: 'the same graph with a real source lint violation',
        should: 'reject that source rather than ignoring the affected graph',
        actual: {
          exitCode: failed.exitCode,
          rules: JSON.parse(failed.stdout.toString()).flatMap(
            (file: { messages: { ruleId: string }[] }) =>
              file.messages.map(({ ruleId }) => ruleId),
          ),
        },
        expected: { exitCode: 1, rules: ['no-debugger'] },
      });
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('uses every dependent task directory and rejects invalid dry-run output', async () => {
    const { affectedLintDirectories } = await import('./check-affected');
    assert({
      given: 'a producer and dependent selected by Turbo',
      should: 'lint both workspaces once',
      actual: affectedLintDirectories({
        tasks: [
          { directory: 'packages/protocol' },
          { directory: 'apps/web' },
          { directory: 'apps/web' },
        ],
      }),
      expected: ['apps/web', 'packages/protocol'],
    });
  });
});
