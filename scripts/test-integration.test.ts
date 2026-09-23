import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  claimsIntegrationSuite,
  INTEGRATION_RUNNER,
  integrationSuites,
} from './test-integration';

setupRitewayBun();

describe('integration suite discovery', () => {
  test('finds suites by folder and suffix, in a stable order', () => {
    assert({
      given: 'files under integration/ and elsewhere',
      should: 'keep integration suites only, sorted',
      actual: integrationSuites([
        'integration/redis.integration.ts',
        'integration/seed.integration.test.ts',
        'integration/webauthn-authenticator.smoke.integration.ts',
        'integration/support/fixtures.ts',
        'src/index.test.ts',
        'integration/nested/outbox.integration.ts',
      ]),
      expected: [
        'integration/nested/outbox.integration.ts',
        'integration/redis.integration.ts',
        'integration/seed.integration.test.ts',
        'integration/webauthn-authenticator.smoke.integration.ts',
      ],
    });
  });

  test('lets bun evidence count every discovered suite as claimed', () => {
    assert({
      given: 'the discovery runner, and a hand-kept list that misses a file',
      should: 'claim any suite under integration/ only for the runner',
      actual: [
        claimsIntegrationSuite(
          INTEGRATION_RUNNER,
          'packages/db/integration/new.integration.ts',
        ),
        claimsIntegrationSuite(
          'bun test ./integration/old.integration.ts',
          'packages/db/integration/new.integration.ts',
        ),
        claimsIntegrationSuite(
          INTEGRATION_RUNNER,
          'packages/db/src/not-integration.ts',
        ),
      ],
      expected: [true, false, false],
    });
  });
});
