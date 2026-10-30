import { env } from './server-env.test-support';
import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { authEnv, mailEnv, webhookSecret } from './auth-env.test-support';
import {
  readAuthConfig,
  readBrowserConfig,
  readMailConfig,
  readRealtimeConfig,
  readServerConfig,
} from './index';

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
        AUTH_TRUSTED_PROXIES: [],
        AUTH_SIGN_UP_MAIL_CEILINGS: { perMinute: 120, perDay: 3000 },
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
        'AUTH_SIGN_UP_MAIL_CEILINGS',
        'AUTH_TRUSTED_PROXIES',
        'BETTER_AUTH_SECRET',
        'PUBLIC_APP_URL',
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
});
describe('mail configuration (ISSUE-780)', () => {
  test('validates exactly the mail fields', () => {
    assert({
      given: 'a complete mail environment',
      should: 'expose the sender, provider key and recipient hash secret',
      actual: readMailConfig(mailEnv),
      expected: {
        RECIPIENT_HASH_SECRET: mailEnv.RECIPIENT_HASH_SECRET,
        RESEND_API_KEY: mailEnv.RESEND_API_KEY,
        EMAIL_FROM: mailEnv.EMAIL_FROM,
      },
    });
  });

  test('an auth-only misconfiguration never breaks mail', () => {
    assert({
      given: 'a missing BETTER_AUTH_SECRET and a malformed PUBLIC_APP_URL',
      should:
        'still validate the mail configuration, so beta mail keeps sending',
      actual: readMailConfig({
        ...authEnv,
        BETTER_AUTH_SECRET: undefined,
        PUBLIC_APP_URL: 'not-a-url',
      }).EMAIL_FROM,
      expected: mailEnv.EMAIL_FROM,
    });
  });

  test('refuses a missing RECIPIENT_HASH_SECRET, naming the field only', () => {
    const withoutRecipientHashSecret = { ...mailEnv };
    Reflect.deleteProperty(withoutRecipientHashSecret, 'RECIPIENT_HASH_SECRET');
    assert({
      given:
        'an otherwise-complete mail environment with no RECIPIENT_HASH_SECRET',
      should: 'refuse, naming the field',
      actual: failureOf(() => readMailConfig(withoutRecipientHashSecret)),
      expected: 'Error: Invalid mail configuration: RECIPIENT_HASH_SECRET',
    });
  });

  test('rejects short, blank and header-injecting values by field name only', () => {
    let message = '';
    try {
      readMailConfig({
        ...mailEnv,
        RECIPIENT_HASH_SECRET: 'too-short',
        RESEND_API_KEY: ' ',
        EMAIL_FROM: 'not-an-address\r\nBcc: victim@example.com',
      });
    } catch (error) {
      message = String(error);
    }
    assert({
      given:
        'a short hash secret, a blank API key and a header-injecting sender',
      should: 'report exactly those field names and no values',
      actual: {
        namesAll:
          message.includes('RECIPIENT_HASH_SECRET') &&
          message.includes('RESEND_API_KEY') &&
          message.includes('EMAIL_FROM'),
        echoesValue:
          message.includes('too-short') ||
          message.includes('not-an-address') ||
          message.includes('Bcc'),
      },
      expected: { namesAll: true, echoesValue: false },
    });
  });

  test('rejects invalid sender mailbox syntax', () => {
    assert({
      given: 'a sender without a valid mailbox',
      should: 'reject the sender configuration by field name',
      actual: failureOf(() =>
        readMailConfig({ ...mailEnv, EMAIL_FROM: 'Daisy Debate @' }),
      ),
      expected: 'Error: Invalid mail configuration: EMAIL_FROM',
    });
  });

  test('production requires the webhook signing secret; development does not', () => {
    const production = { ...mailEnv, NODE_ENV: 'production' };
    assert({
      given:
        'production without, then with, a valid whsec_ secret, and development without one',
      should:
        'refuse naming the field, then validate it, and not require it outside production',
      actual: [
        failureOf(() => readMailConfig(production)),
        readMailConfig({ ...production, RESEND_WEBHOOK_SECRET: webhookSecret })
          .RESEND_WEBHOOK_SECRET,
        'RESEND_WEBHOOK_SECRET' in readMailConfig(mailEnv),
      ],
      expected: [
        'Error: Invalid mail configuration: RESEND_WEBHOOK_SECRET',
        webhookSecret,
        false,
      ],
    });
  });

  test('rejects a malformed webhook secret', () => {
    assert({
      given: 'a webhook secret without the whsec_ shape',
      should: 'reject naming the field',
      actual: failureOf(() =>
        readMailConfig({ ...mailEnv, RESEND_WEBHOOK_SECRET: 'not a secret' }),
      ),
      expected: 'Error: Invalid mail configuration: RESEND_WEBHOOK_SECRET',
    });
  });

  test('accepts optional Sentry gates and refuses a malformed DSN by name (ADR 0037)', () => {
    const dsn = 'https://examplePublicKey@o0.ingest.sentry.io/456';
    const server = readServerConfig({
      ...env,
      SENTRY_DSN: dsn,
      SENTRY_ENVIRONMENT: 'production',
      NEXT_PUBLIC_SENTRY_DSN: dsn,
    });
    assert({
      given: 'valid Sentry variables',
      should: 'carry them on the validated server configuration',
      actual: {
        dsn: server.SENTRY_DSN,
        environment: server.SENTRY_ENVIRONMENT,
        publicDsn: server.NEXT_PUBLIC_SENTRY_DSN,
      },
      expected: { dsn, environment: 'production', publicDsn: dsn },
    });
    assert({
      given: 'no Sentry variables',
      should: 'leave every gate unset, so the adapters stay inert',
      actual: {
        dsn: readServerConfig(env).SENTRY_DSN,
        publicDsn: readServerConfig(env).NEXT_PUBLIC_SENTRY_DSN,
      },
      expected: { dsn: undefined, publicDsn: undefined },
    });
    assert({
      given: 'a SENTRY_DSN that is not a URL',
      should: 'refuse naming the field only',
      actual: failureOf(() => readServerConfig({ ...env, SENTRY_DSN: 'dsn' })),
      expected: 'Error: Invalid server configuration: SENTRY_DSN',
    });
    assert({
      given: 'realtime environment carrying the same variable names',
      should: 'validate them on realtime configuration',
      actual: readRealtimeConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://user:secret@localhost:5432/daisy',
        REDIS_URL: 'redis://localhost:6379',
        SENTRY_DSN: dsn,
      }).SENTRY_DSN,
      expected: dsn,
    });
  });
});
// OPS_PROBE_TOKEN (AUTH-7.7) has its own suite: ops-probe-token.test.ts.
