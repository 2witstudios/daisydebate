import { expect } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { env } from './server-env.test-support';
import { readServerConfig, readBrowserConfig } from './index';
setupRitewayBun();

test('premium beta grant is a validated server-only deployment policy', () => {
  assert({
    given: 'default beta, launch false and explicitly enabled beta',
    should: 'parse the grant without exposing it to browser config',
    actual: [
      readServerConfig(env).PREMIUM_BETA_GRANT,
      readServerConfig({ ...env, PREMIUM_BETA_GRANT: 'false' })
        .PREMIUM_BETA_GRANT,
      readServerConfig({ ...env, PREMIUM_BETA_GRANT: 'true' })
        .PREMIUM_BETA_GRANT,
      Object.hasOwn(
        readBrowserConfig({ ...env, PREMIUM_BETA_GRANT: 'true' }),
        'PREMIUM_BETA_GRANT',
      ),
    ],
    expected: [true, false, true, false],
  });
  expect(() => readServerConfig({ ...env, PREMIUM_BETA_GRANT: 'yes' })).toThrow(
    'Invalid server configuration',
  );
});
