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
      actual: validatePolicyRegistry({
        version: 1,
        exceptions: [
          {
            path: 'packages/*',
            rule: 'direct-random-uuid',
            category: 'local-ignore',
            owner: 'unknown',
            reason: 'not specific',
          },
        ],
      }),
      expected: [
        'registry[0]: wildcard paths are not allowed',
        'registry[0]: unknown category local-ignore',
      ],
    });
  });
});
