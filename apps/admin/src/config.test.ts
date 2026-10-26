import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readAdminConfig, readAdminMigrationUrl } from './config';

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
