import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readBrowserConfig, readServerConfig } from './index';

setupRitewayBun();

const env = {
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
});
