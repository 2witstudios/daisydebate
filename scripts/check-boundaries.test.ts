import {
  adobeIsolationIssue,
  adobeWorkspaces,
  allowedWorkspaceDependencies,
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
