import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { partitionAffected, planGates } from './check-affected';

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
  test('always includes the boundaries gate', () => {
    assert({
      given: 'no changed files',
      should: 'still verify architecture boundaries',
      actual: planGates(partitionAffected([]), 'sha0').map(({ name }) =>
        name.includes('boundaries'),
      ),
      expected: [true],
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
});
