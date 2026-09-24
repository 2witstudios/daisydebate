import {
  adobeIsolationIssue,
  adobeWorkspaces,
  allowedWorkspaceDependencies,
  deepImportIssue,
  testSupportIssue,
  forbiddenDependencyIssue,
} from './boundaries-rules';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const workspaces = [
  '@daisy/web',
  '@daisy/debate-engine',
  '@daisy/protocol',
  '@daisy/db',
  '@daisy/redis',
  '@daisy/auth',
  '@daisy/errors',
  '@daisy/config',
  '@daisy/clock',
  '@daisy/logger',
  '@daisy/observability',
  '@daisy/typescript-config',
] as const;

describe('Adobe isolation rule', () => {
  for (const name of workspaces) {
    if (name === '@daisy/debate-engine') continue;
    test(`${name} declaring an @adobe dependency is blocked`, () => {
      assert({
        given: `${name} declaring dependency @adobe/data`,
        should: 'report an Adobe isolation issue',
        actual: adobeIsolationIssue(name, '@adobe/data', 'dependency'),
        expected: `${name}: Adobe dependency outside the engine`,
      });
    });
    test(`${name} importing @adobe/* is blocked`, () => {
      assert({
        given: `${name} importing @adobe/data/ecs`,
        should: 'report an Adobe isolation issue',
        actual: adobeIsolationIssue(name, '@adobe/data/ecs', 'import'),
        expected: `${name}: Adobe import outside the engine`,
      });
    });
  }

  test('the engine may declare and import @adobe packages', () => {
    assert({
      given: '@daisy/debate-engine using @adobe packages',
      should: 'report no issue',
      actual: [
        adobeIsolationIssue(
          '@daisy/debate-engine',
          '@adobe/data',
          'dependency',
        ),
        adobeIsolationIssue(
          '@daisy/debate-engine',
          '@adobe/data/ecs',
          'import',
        ),
      ],
      expected: [null, null],
    });
  });

  test('non-Adobe specifiers are never flagged', () => {
    assert({
      given: 'a non-Adobe dependency or import in a restricted workspace',
      should: 'report no issue',
      actual: [
        adobeIsolationIssue('@daisy/db', 'drizzle-orm', 'dependency'),
        adobeIsolationIssue('@daisy/protocol', 'zod', 'import'),
      ],
      expected: [null, null],
    });
  });

  test('the allowlist covers exactly the engine', () => {
    assert({
      given: 'the Adobe workspace allowlist',
      should: 'list exactly the engine adapter owner',
      actual: [...adobeWorkspaces],
      expected: ['@daisy/debate-engine'],
    });
  });
});

describe('realtime workspace edges (ADR 0031 §12)', () => {
  test('the allowlist names exactly the ten ADR 0031 §12 edges', () => {
    assert({
      given: 'allowedWorkspaceDependencies.realtime',
      should: 'list exactly the ten edges the ADR mechanically enforces',
      actual: [...allowedWorkspaceDependencies.realtime!].sort(),
      expected: [
        'auth',
        'clock',
        'config',
        'db',
        'errors',
        'logger',
        'observability',
        'presence',
        'protocol',
        'redis',
      ].sort(),
    });
  });

  test('a realtime manifest depending on debate-engine is forbidden', () => {
    assert({
      given: 'apps/realtime declaring @daisy/debate-engine',
      should: 'report a forbidden dependency',
      actual: forbiddenDependencyIssue(
        'apps/realtime',
        '@daisy/realtime',
        '@daisy/debate-engine',
        allowedWorkspaceDependencies,
      ),
      expected: 'apps/realtime: forbidden dependency @daisy/debate-engine',
    });
  });

  test('a realtime manifest depending on apps/web is forbidden', () => {
    assert({
      given: 'apps/realtime declaring @daisy/web',
      should: 'report a forbidden dependency',
      actual: forbiddenDependencyIssue(
        'apps/realtime',
        '@daisy/realtime',
        '@daisy/web',
        allowedWorkspaceDependencies,
      ),
      expected: 'apps/realtime: forbidden dependency @daisy/web',
    });
  });

  test('a realtime manifest depending on one of its ten allowed edges is not flagged', () => {
    assert({
      given: 'apps/realtime declaring @daisy/protocol',
      should: 'report no issue',
      actual: forbiddenDependencyIssue(
        'apps/realtime',
        '@daisy/realtime',
        '@daisy/protocol',
        allowedWorkspaceDependencies,
      ),
      expected: null,
    });
  });

  test('deleting the realtime key removes the restriction entirely', () => {
    const withoutRealtime = Object.fromEntries(
      Object.entries(allowedWorkspaceDependencies).filter(
        ([key]) => key !== 'realtime',
      ),
    );

    assert({
      given: 'the realtime key removed from allowedWorkspaceDependencies',
      should:
        'no longer forbid @daisy/debate-engine, proving the fixture is load-bearing',
      actual: forbiddenDependencyIssue(
        'apps/realtime',
        '@daisy/realtime',
        '@daisy/debate-engine',
        withoutRealtime,
      ),
      expected: null,
    });
  });
});

describe('workspace deep imports', () => {
  const exportsOf = (name: string) =>
    name === '@daisy/errors'
      ? { '.': './src/index.ts', './testing': './src/testing.ts' }
      : { '.': './src/index.ts' };

  test('admits a package root and a subpath the package exports', () => {
    assert({
      given: "a package's root and a subpath named in its exports map",
      should: 'report no issue for either',
      actual: [
        deepImportIssue('@daisy/errors', exportsOf),
        deepImportIssue('@daisy/errors/testing', exportsOf),
      ],
      expected: [null, null],
    });
  });

  test('refuses a subpath the package does not export', () => {
    assert({
      given: 'a reach into a source file the exports map does not name',
      should: 'report the deep import',
      actual: [
        deepImportIssue('@daisy/errors/src/index', exportsOf),
        deepImportIssue('@daisy/db/schema', exportsOf),
      ],
      expected: [
        'workspace deep import @daisy/errors/src/index',
        'workspace deep import @daisy/db/schema',
      ],
    });
  });

  test('ignores packages outside the workspace', () => {
    assert({
      given: 'a subpath import of a third-party package',
      should: 'leave it to the dependency rules',
      actual: deepImportIssue('drizzle-orm/pg-core', exportsOf),
      expected: null,
    });
  });
});

describe('test support subpaths', () => {
  test('admits a testing subpath from suites and test support', () => {
    assert({
      given:
        '@daisy/errors/testing imported by unit, integration, e2e and support files',
      should: 'report no issue',
      actual: [
        'packages/debate-engine/src/engine.test.ts',
        'apps/web/src/ui/app.test.tsx',
        'packages/db/integration/outbox.integration.ts',
        'apps/web/integration/fixtures.ts',
        'apps/web/e2e/support/accounts.ts',
        'packages/debate-engine/src/runtime.test-support.ts',
        'packages/redis/integration/test-support.ts',
      ].map((file) => testSupportIssue('@daisy/errors/testing', file)),
      expected: Array(7).fill(null),
    });
  });

  test('refuses a testing subpath from production source', () => {
    assert({
      given: '@daisy/errors/testing imported by a production module',
      should: 'report the production import of test support',
      actual: [
        testSupportIssue('@daisy/errors/testing', 'packages/db/src/outbox.ts'),
        testSupportIssue(
          '@daisy/errors/testing',
          'apps/web/src/features/integration/sync.ts',
        ),
        testSupportIssue('@daisy/errors', 'packages/db/src/outbox.ts'),
      ],
      expected: [
        'production import of test support @daisy/errors/testing',
        'production import of test support @daisy/errors/testing',
        null,
      ],
    });
  });
});
