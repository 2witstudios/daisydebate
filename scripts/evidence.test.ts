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

  test('sees TSX suites so they cannot hide from the gate', () => {
    assert({
      given: 'React component, integration, and e2e suites written in TSX',
      should: 'treat every one as a suite file, and a plain component as not',
      actual: [
        'apps/web/src/ui/store/store.test.tsx',
        'apps/web/src/ui/store/store.integration.tsx',
        'apps/web/e2e/app.e2e.tsx',
        'apps/web/src/ui/store/store.tsx',
      ].map(isTestFilePath),
      expected: [true, true, true, false],
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

  test('claims TSX unit suites wherever bun test executes them', () => {
    assert({
      given: '.test.tsx files under a workspace src/ and under root scripts/',
      should: 'assign the tier of the bun test runner that globs them',
      actual: [
        'apps/web/src/ui/components/nav-item/nav-item.render.test.tsx',
        'apps/web/src/ui/store/store.test.tsx',
        'scripts/report.test.tsx',
      ].map(classifyTestFile),
      expected: ['unit', 'unit', 'root-script'],
    });
  });

  test('flags a TSX unit suite outside claimed locations as an orphan', () => {
    assert({
      given: 'a .test.tsx file beside src/ instead of inside it',
      should: 'mark it an orphan',
      actual: classifyTestFile('apps/web/components/button.test.tsx'),
      expected: 'orphan',
    });
  });

  test('flags TSX suites no runner globs as orphans', () => {
    assert({
      given:
        'an .e2e.tsx outside the Playwright testMatch and an .integration.tsx outside the bun test src glob',
      should: 'mark both orphans instead of counting them as claimed',
      actual: [
        'apps/web/e2e/app.e2e.tsx',
        'apps/web/src/ui/store/store.integration.tsx',
      ].map(classifyTestFile),
      expected: ['orphan', 'orphan'],
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
