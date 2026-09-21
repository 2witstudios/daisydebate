import { adobeIsolationIssue, adobeWorkspaces } from './boundaries-rules';
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
