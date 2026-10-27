import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  readAdminConfig,
  readAdminMigrationUrl,
  readLogStoreConfig,
  readOperatorClientConfig,
} from './config';

setupRitewayBun();
const valid = {
  ADMIN_DATABASE_URL: 'postgres://daisy_admin_app:secret-value@db/daisy_admin',
  ADMIN_ATTEMPT_KEY: 'k'.repeat(43),
};

test('readAdminConfig', () => {
  assert({
    given: 'the two required values',
    should: 'default to the canonical local port and host',
    actual: (({ ADMIN_PORT, ADMIN_HOST, NODE_ENV }) => ({
      ADMIN_PORT,
      ADMIN_HOST,
      NODE_ENV,
    }))(readAdminConfig(valid)),
    expected: {
      ADMIN_PORT: 4800,
      ADMIN_HOST: 'localhost',
      NODE_ENV: 'development',
    },
  });
  let message = '';
  try {
    readAdminConfig({ ...valid, ADMIN_ATTEMPT_KEY: 'short-secret-value' });
  } catch (error) {
    message = (error as Error).message;
  }
  assert({
    given: 'a short attempt key',
    should: 'name the field and never echo its value',
    actual: [message.includes('ADMIN_ATTEMPT_KEY'), message.includes('short')],
    expected: [true, false],
  });
});

test('a non-loopback bind outside production', () => {
  const refusal = (env: Record<string, string>) => {
    try {
      return readAdminConfig({ ...valid, ...env }).ADMIN_HOST;
    } catch (error) {
      return (error as Error).message;
    }
  };
  assert({
    given: 'ADMIN_HOST "::" with NODE_ENV unset, development or production',
    should:
      'refuse unless production, so a deployed process never runs as development and skips the role refusal',
    actual: [
      refusal({ ADMIN_HOST: '::' }),
      refusal({ ADMIN_HOST: '::', NODE_ENV: 'development' }),
      refusal({ ADMIN_HOST: '::', NODE_ENV: 'production' }),
    ],
    expected: [
      'Invalid admin configuration: NODE_ENV',
      'Invalid admin configuration: NODE_ENV',
      '::',
    ],
  });
});

test('readAdminMigrationUrl', () => {
  assert({
    given: 'a missing owner URL',
    should: 'refuse naming only the field',
    actual: (() => {
      try {
        return readAdminMigrationUrl({});
      } catch (error) {
        return (error as Error).message;
      }
    })(),
    expected: 'Invalid admin configuration: ADMIN_MIGRATION_DATABASE_URL',
  });
});

test('readOperatorClientConfig', () => {
  const operator = {
    OPERATOR_API_URL: 'http://daisy-debate-staging.internal:8081',
    OPERATOR_API_KEY_ID: 'admin1',
    OPERATOR_API_KEY: Buffer.from(new Uint8Array(32).fill(9)).toString(
      'base64url',
    ),
    OPERATOR_AUDIENCE: 'daisy-web:staging',
  };
  const outcome = (env: Record<string, string>) => {
    try {
      const config = readOperatorClientConfig(env);
      return config && { ...config, key: config.key.byteLength };
    } catch (error) {
      return (error as Error).message;
    }
  };
  const withoutKey: Record<string, string> = { ...operator };
  delete withoutKey.OPERATOR_API_KEY;
  assert({
    given: 'none, all four, three of four, and a key shorter than 32 bytes',
    should:
      'stay unconfigured, decode the client config, or refuse naming fields and never values',
    actual: [
      outcome({}),
      outcome(operator),
      outcome(withoutKey),
      outcome({ ...operator, OPERATOR_API_KEY: 'c2hvcnQ' }),
      outcome({ ...operator, OPERATOR_AUDIENCE: 'daisy-web:elsewhere' }),
    ],
    expected: [
      null,
      {
        baseUrl: operator.OPERATOR_API_URL,
        keyId: 'admin1',
        key: 32,
        audience: 'daisy-web:staging',
      },
      'Invalid admin configuration: OPERATOR_API_KEY',
      'Invalid admin configuration: OPERATOR_API_KEY',
      'Invalid admin configuration: OPERATOR_AUDIENCE',
    ],
  });
});

test('readLogStoreConfig', () => {
  const store = {
    CLICKHOUSE_URL: 'http://daisy-debate-staging-clickhouse.internal:8123',
    CLICKHOUSE_READER_PASSWORD: 'r'.repeat(43),
  };
  const outcome = (env: Record<string, string>) => {
    try {
      return readLogStoreConfig(env);
    } catch (error) {
      return (error as Error).message;
    }
  };
  assert({
    given: 'neither, both, the URL alone, and a short password',
    should:
      'stay unconfigured, return the connection, or refuse naming fields and never values',
    actual: [
      outcome({}),
      outcome(store),
      outcome({ CLICKHOUSE_URL: store.CLICKHOUSE_URL }),
      outcome({ ...store, CLICKHOUSE_READER_PASSWORD: 'short' }),
    ],
    expected: [
      null,
      { url: store.CLICKHOUSE_URL, password: store.CLICKHOUSE_READER_PASSWORD },
      'Invalid admin configuration: CLICKHOUSE_READER_PASSWORD',
      'Invalid admin configuration: CLICKHOUSE_READER_PASSWORD',
    ],
  });
});
