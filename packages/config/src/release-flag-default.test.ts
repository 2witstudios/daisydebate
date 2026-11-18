import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readServerConfig } from './index';
import { env } from './server-env.test-support';

setupRitewayBun();

const deployed = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://user:production@db.example.com:5432/daisy',
  REDIS_URL: 'redis://cache.example.com:6379',
  PUBLIC_APP_URL: 'https://daisy.example.com',
  APP_VERSION: '1.0.0',
  GIT_COMMIT: 'abc1234',
};

/** The parsed default, or the refusal's message. */
const startup = (input: Record<string, string>) => {
  try {
    return readServerConfig(input).DAISY_RELEASE_FLAG_DEFAULT ?? 'unset';
  } catch (error) {
    return (error as Error).message;
  }
};

describe('release flag default (ADR 0118)', () => {
  test('production refuses the variable at startup; staging accepts it', () => {
    const on = { DAISY_RELEASE_FLAG_DEFAULT: 'enabled' };
    assert({
      given:
        'the variable in production with no audience, the production audience, the local audience, then staging, development, an unknown value and its absence',
      should:
        'refuse every production deployment but staging by name, accept staging and development, refuse other values and default to unset',
      actual: [
        startup({ ...deployed, ...on }),
        startup({
          ...deployed,
          ...on,
          OPERATOR_AUDIENCE: 'daisy-web:production',
        }),
        startup({ ...deployed, ...on, OPERATOR_AUDIENCE: 'daisy-web:local' }),
        startup({ ...deployed, ...on, OPERATOR_AUDIENCE: 'daisy-web:staging' }),
        startup({ ...env, ...on }),
        startup({ ...env, DAISY_RELEASE_FLAG_DEFAULT: 'true' }),
        startup(deployed),
      ],
      expected: [
        'Invalid server configuration: DAISY_RELEASE_FLAG_DEFAULT',
        'Invalid server configuration: DAISY_RELEASE_FLAG_DEFAULT',
        'Invalid server configuration: DAISY_RELEASE_FLAG_DEFAULT',
        'enabled',
        'enabled',
        'Invalid server configuration: DAISY_RELEASE_FLAG_DEFAULT',
        'unset',
      ],
    });
  });
});
