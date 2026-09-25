import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { authEnv } from './auth-env.test-support';
import { readAuthConfig, readBrowserConfig, readServerConfig } from './index';

setupRitewayBun();

/** The message a rejected configuration throws, or `accepted`. */
const failureOf = (read: () => unknown) => {
  try {
    read();
    return 'accepted';
  } catch (error) {
    return String(error);
  }
};

const env = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://user:secret@localhost:5432/daisy',
  REDIS_URL: 'redis://localhost:6379',
  PUBLIC_APP_URL: 'http://localhost:3000',
};

describe('configuration', () => {
  test('strips secrets from the browser allowlist', () => {
    assert({
      given: 'server environment variables',
      should: 'expose only the browser allowlist to the browser',
      actual: readBrowserConfig(env),
      expected: {
        PUBLIC_APP_URL: env.PUBLIC_APP_URL,
      },
    });
  });

  test('production fails closed and errors never include credentials', () => {
    expect(() => readServerConfig({ ...env, NODE_ENV: 'production' })).toThrow(
      'Invalid server configuration',
    );
    let message = '';
    try {
      readServerConfig({ ...env, DATABASE_URL: 'secret' });
    } catch (error) {
      message = String(error);
    }
    assert({
      given: 'a rejected environment containing a credential-like value',
      should: 'never echo the value',
      actual: message.includes('secret'),
      expected: false,
    });
  });

  test('development configuration validates explicit dependencies', () => {
    assert({
      given: 'a development environment without a namespace override',
      should: 'default the Redis namespace to daisy',
      actual: readServerConfig(env).REDIS_NAMESPACE,
      expected: 'daisy',
    });
  });

  test('a missing NODE_ENV refuses to start rather than skip production checks', () => {
    const withoutNodeEnv = { ...env };
    Reflect.deleteProperty(withoutNodeEnv, 'NODE_ENV');
    expect(() => readServerConfig(withoutNodeEnv)).toThrow(
      'Invalid server configuration',
    );
  });

  test('production succeeds without authentication variables before auth activates', () => {
    assert({
      given: 'a valid production environment without auth variables',
      should: 'keep baseline startup validation passing',
      actual: readServerConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://user:production@db.example.com:5432/daisy',
        REDIS_URL: 'redis://cache.example.com:6379',
        PUBLIC_APP_URL: 'https://daisy.example.com',
        APP_VERSION: '1.0.0',
        GIT_COMMIT: 'abc1234',
      }).PUBLIC_APP_URL,
      expected: 'https://daisy.example.com',
    });
  });
});

describe('authentication configuration', () => {
  test('a missing NODE_ENV refuses to start rather than skip production checks', () => {
    const withoutNodeEnv = { ...authEnv };
    Reflect.deleteProperty(withoutNodeEnv, 'NODE_ENV');
    expect(() => readAuthConfig(withoutNodeEnv)).toThrow(
      'Invalid auth configuration',
    );
  });

  test('validates the auth fields and trusts no proxy by default', () => {
    assert({
      given: 'a complete server authentication environment',
      should: 'expose the validated auth fields with an empty proxy list',
      actual: readAuthConfig(authEnv),
      expected: {
        BETTER_AUTH_SECRET: authEnv.BETTER_AUTH_SECRET,
        PUBLIC_APP_URL: authEnv.PUBLIC_APP_URL,
        RESEND_API_KEY: authEnv.RESEND_API_KEY,
        AUTH_EMAIL_FROM: authEnv.AUTH_EMAIL_FROM,
        AUTH_TRUSTED_PROXIES: [],
      },
    });
  });

  test('rejects a short secret and reports the field name only', () => {
    let message = '';
    try {
      readAuthConfig({ ...authEnv, BETTER_AUTH_SECRET: 'too-short' });
    } catch (error) {
      message = String(error);
    }
    assert({
      given: 'a 9-character BETTER_AUTH_SECRET',
      should: 'name the field without echoing the value',
      actual: {
        namesField: message.includes('BETTER_AUTH_SECRET'),
        echoesValue: message.includes('too-short'),
      },
      expected: { namesField: true, echoesValue: false },
    });
  });

  test('rejects blank and malformed values by field name only', () => {
    let message = '';
    try {
      readAuthConfig({
        ...authEnv,
        RESEND_API_KEY: ' ',
        AUTH_EMAIL_FROM: 'not-an-address\r\nBcc: victim@example.com',
        PUBLIC_APP_URL: 'not-a-url',
      });
    } catch (error) {
      message = String(error);
    }
    assert({
      given: 'a blank API key, a header-injecting sender and a bad URL',
      should: 'report exactly those three field names and no values',
      actual: {
        namesAllThree:
          message.includes('RESEND_API_KEY') &&
          message.includes('AUTH_EMAIL_FROM') &&
          message.includes('PUBLIC_APP_URL'),
        echoesValue:
          message.includes('not-an-address') || message.includes('Bcc'),
      },
      expected: { namesAllThree: true, echoesValue: false },
    });
  });

  test('rejects invalid sender mailbox syntax', () => {
    assert({
      given: 'an authentication sender without a valid mailbox',
      should: 'reject the sender configuration by field name',
      actual: failureOf(() =>
        readAuthConfig({ ...authEnv, AUTH_EMAIL_FROM: 'Daisy @' }),
      ),
      expected: 'Error: Invalid auth configuration: AUTH_EMAIL_FROM',
    });
  });

  test('rejects non-HTTP application URLs', () => {
    assert({
      given: 'an application URL with an unsupported scheme',
      should: 'reject the URL configuration by field name',
      actual: failureOf(() =>
        readAuthConfig({
          ...authEnv,
          PUBLIC_APP_URL: 'ftp://daisy.example.com',
        }),
      ),
      expected: 'Error: Invalid auth configuration: PUBLIC_APP_URL',
    });
  });

  test('production auth rejects a non-HTTPS application URL', () => {
    assert({
      given: 'a production environment with an http application URL',
      should: 'reject the configuration naming PUBLIC_APP_URL',
      actual: failureOf(() =>
        readAuthConfig({
          ...authEnv,
          NODE_ENV: 'production',
          PUBLIC_APP_URL: 'http://daisy.example.com',
          RESEND_WEBHOOK_SECRET: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
          OPS_PROBE_TOKEN: 'a'.repeat(32),
        }),
      ),
      expected: 'Error: Invalid auth configuration: PUBLIC_APP_URL',
    });
  });

  test('non-production auth still accepts http application URLs', () => {
    assert({
      given: 'a development environment with a localhost http URL',
      should: 'validate exactly the auth fields',
      actual: Object.keys(
        readAuthConfig({
          ...authEnv,
          PUBLIC_APP_URL: 'http://localhost:3000',
        }),
      ).sort(),
      expected: [
        'AUTH_EMAIL_FROM',
        'AUTH_TRUSTED_PROXIES',
        'BETTER_AUTH_SECRET',
        'PUBLIC_APP_URL',
        'RESEND_API_KEY',
      ],
    });
  });

  test('browser allowlist never carries authentication configuration', () => {
    assert({
      given: 'a server environment including all auth variables',
      should: 'expose only the public app URL to the browser',
      actual: readBrowserConfig(authEnv),
      expected: { PUBLIC_APP_URL: authEnv.PUBLIC_APP_URL },
    });
  });

  test('production requires the webhook signing secret; development does not', () => {
    const production = {
      ...authEnv,
      NODE_ENV: 'production',
    };
    let message = '';
    try {
      readAuthConfig(production);
    } catch (error) {
      message = String(error);
    }
    assert({
      given: 'a production environment without RESEND_WEBHOOK_SECRET',
      should: 'refuse to start naming the field but never a value',
      actual: {
        named: message.includes('RESEND_WEBHOOK_SECRET'),
        leaked: message.includes(authEnv.BETTER_AUTH_SECRET),
      },
      expected: { named: true, leaked: false },
    });
    assert({
      given: 'a production environment with a valid whsec_ secret',
      should: 'validate and expose the secret',
      actual: readAuthConfig({
        ...production,
        RESEND_WEBHOOK_SECRET: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
        OPS_PROBE_TOKEN: 'a'.repeat(32),
      }).RESEND_WEBHOOK_SECRET,
      expected: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
    });
    assert({
      given: 'a development environment without a webhook secret',
      should: 'still validate',
      actual: 'RESEND_WEBHOOK_SECRET' in readAuthConfig(authEnv),
      expected: false,
    });
  });

  test('rejects a malformed webhook secret', () => {
    assert({
      given: 'a webhook secret without the whsec_ shape',
      should: 'reject naming the field',
      actual: failureOf(() =>
        readAuthConfig({ ...authEnv, RESEND_WEBHOOK_SECRET: 'not a secret' }),
      ),
      expected: 'Error: Invalid auth configuration: RESEND_WEBHOOK_SECRET',
    });
  });
});
// OPS_PROBE_TOKEN (AUTH-7.7) has its own suite: ops-probe-token.test.ts.
