import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { scanPolicyText, validatePolicyRegistry } from './policy';

setupRitewayBun();

describe('policy scanner', () => {
  test('detects direct random UUID generation and repository UUID contracts', () => {
    assert({
      given: 'application source using direct UUID generation and validation',
      should: 'report both policy rules',
      actual: scanPolicyText(
        'src/example.ts',
        'crypto.randomUUID();\nconst id = z.uuid();',
      ).map(({ rule }) => rule),
      expected: ['direct-random-uuid', 'repository-owned-uuid'],
    });
  });

  test('does not report unrelated identifiers', () => {
    assert({
      given: 'source using an injected identity',
      should: 'report no policy findings',
      actual: scanPolicyText('src/example.ts', 'const id = ids.next();'),
      expected: [],
    });
  });

  test('rejects broad or unapproved exception entries', () => {
    assert({
      given: 'an exception with a wildcard path and unknown category',
      should: 'reject the registry entry instead of allowing the exception',
      actual: validatePolicyRegistry(
        {
          version: 1,
          exceptions: [
            {
              path: 'packages/*',
              rule: 'direct-random-uuid',
              category: 'local-ignore',
              owner: 'unknown',
              reason: 'not specific',
              adr: 'bad-reference',
              reviewBy: 'not-a-date',
            },
          ],
        },
        {
          knownPaths: new Set(['docs/decisions/0018-cuid2-identifiers.md']),
          today: '2026-09-20',
        },
      ),
      expected: [
        'registry[0]: wildcard paths are not allowed',
        'registry[0]: path does not exist: packages/*',
        'registry[0]: unknown category local-ignore',
        'registry[0]: invalid ADR reference bad-reference',
        'registry[0]: ADR does not exist: bad-reference',
        'registry[0]: reviewBy must be an ISO date',
      ],
    });
  });

  test('requires ADR and review fields', () => {
    assert({
      given: 'an exception without lifecycle metadata',
      should: 'reject missing ADR and review fields',
      actual: validatePolicyRegistry({
        version: 1,
        exceptions: [
          {
            path: 'src/example.ts',
            rule: 'direct-random-uuid',
            category: 'tooling',
            owner: 'platform',
            reason: 'fixture',
          },
        ],
      }),
      expected: [
        'registry[0]: adr is required',
        'registry[0]: reviewBy is required',
      ],
    });
  });

  test('rejects expired review dates', () => {
    assert({
      given: 'an exception whose review date is before today',
      should: 'require review before the exception can pass',
      actual: validatePolicyRegistry(
        {
          version: 1,
          exceptions: [
            {
              path: 'src/example.ts',
              rule: 'direct-random-uuid',
              category: 'tooling',
              owner: 'platform',
              reason: 'fixture',
              adr: 'docs/decisions/0018-cuid2-identifiers.md',
              reviewBy: '2026-09-19',
            },
          ],
        },
        {
          knownPaths: new Set([
            'src/example.ts',
            'docs/decisions/0018-cuid2-identifiers.md',
          ]),
          today: '2026-09-20',
        },
      ),
      expected: ['registry[0]: reviewBy has expired: 2026-09-19'],
    });
  });

  test('rejects duplicate exception entries', () => {
    const entry = {
      path: 'src/example.ts',
      rule: 'direct-random-uuid' as const,
      category: 'tooling' as const,
      owner: 'platform',
      reason: 'fixture',
      adr: 'docs/decisions/0018-cuid2-identifiers.md',
      reviewBy: '2026-09-20',
    };
    assert({
      given: 'two entries for the same path and rule',
      should: 'reject the duplicate exception',
      actual: validatePolicyRegistry(
        { version: 1, exceptions: [entry, entry] },
        {
          knownPaths: new Set([
            'src/example.ts',
            'docs/decisions/0018-cuid2-identifiers.md',
          ]),
          today: '2026-09-20',
        },
      ),
      expected: ['registry[1]: duplicate src/example.ts|direct-random-uuid'],
    });
  });
});
