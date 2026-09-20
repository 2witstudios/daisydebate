import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  classifyTestFile,
  integrationGuardProblems,
  isTestFilePath,
} from './evidence';

setupRitewayBun();

describe('isTestFilePath', () => {
  test('recognizes the three suite suffixes and nothing else', () => {
    assert({
      given: 'unit, integration, e2e, and non-test paths',
      should: 'classify only suite files',
      actual: [
        'packages/db/src/index.test.ts',
        'packages/db/integration/db.integration.ts',
        'apps/web/e2e/app.e2e.ts',
        'packages/db/src/index.ts',
        'README.md',
      ].map(isTestFilePath),
      expected: [true, true, true, false, false],
    });
  });
});

describe('classifyTestFile', () => {
  test('routes each suite to its claiming runner', () => {
    assert({
      given: 'one file per tier',
      should: 'assign the tier whose runner claims it',
      actual: {
        unit: classifyTestFile('packages/protocol/src/index.test.ts'),
        rootScript: classifyTestFile('scripts/doctor.test.ts'),
        rootConfig: classifyTestFile('eslint.config.test.ts'),
        integration: classifyTestFile(
          'apps/web/integration/foundation.integration.ts',
        ),
        e2e: classifyTestFile('apps/web/e2e/app.e2e.ts'),
      },
      expected: {
        unit: 'unit',
        rootScript: 'root-script',
        rootConfig: 'root-config',
        integration: 'integration',
        e2e: 'e2e',
      },
    });
  });

  test('flags suites outside claimed locations as orphans', () => {
    assert({
      given: 'a test file at a package root instead of src/',
      should: 'mark it an orphan',
      actual: classifyTestFile('packages/db/misplaced.test.ts'),
      expected: 'orphan',
    });
  });
});

describe('integrationGuardProblems', () => {
  test('accepts a suite that throws on a missing test service', () => {
    const content = [
      'const url = process.env.TEST_DATABASE_URL;',
      "if (!url) throw new Error('TEST_DATABASE_URL required');",
    ].join('\n');
    assert({
      given: 'a hard-failing environment guard',
      should: 'report no problems',
      actual: integrationGuardProblems(content, 'db.integration.ts'),
      expected: [],
    });
  });

  test('flags a suite that can silently pass without services', () => {
    const content = 'const url = process.env.TEST_DATABASE_URL;';
    assert({
      given: 'a guard that never throws',
      should: 'fail with GUARD_MISSING instead of trusting a silent skip',
      actual: integrationGuardProblems(content, 'db.integration.ts').map(
        ({ code }) => code,
      ),
      expected: ['GUARD_MISSING'],
    });
  });

  test('flags a suite that declares no test environment at all', () => {
    assert({
      given: 'an integration suite without any test service env var',
      should: 'fail with GUARD_MISSING',
      actual:
        integrationGuardProblems("test('x', () => {});", 'loose.integration.ts')
          .length > 0,
      expected: true,
    });
  });
});
