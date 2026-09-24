import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from './index';

setupRitewayBun();

describe('requireTestServices', () => {
  const testEnv = {
    TEST_DATABASE_URL: 'postgres://user:secret@localhost:5432/daisy_test',
    TEST_REDIS_URL: 'redis://localhost:6379',
  };
  const failureOf = (env: Record<string, string | undefined>) => {
    try {
      requireTestServices(env);
      return 'accepted';
    } catch (error) {
      return String(error);
    }
  };

  test('hands a suite both isolated service URLs', () => {
    assert({
      given: 'a test database URL ending in _test and a Redis URL',
      should: 'return both URLs',
      actual: requireTestServices(testEnv),
      expected: {
        databaseUrl: testEnv.TEST_DATABASE_URL,
        redisUrl: testEnv.TEST_REDIS_URL,
      },
    });
  });

  test('throws, never skips, naming each missing or unsafe service', () => {
    assert({
      given: 'no services, a non-test database, and a missing Redis URL',
      should: 'throw naming the fields and the _test rule, never a value',
      actual: [
        failureOf({}),
        failureOf({
          ...testEnv,
          TEST_DATABASE_URL: 'postgres://user:secret@localhost:5432/daisy',
        }),
        failureOf({ TEST_DATABASE_URL: testEnv.TEST_DATABASE_URL }),
      ],
      expected: [
        'Error: Integration suites require isolated test services: TEST_DATABASE_URL, TEST_REDIS_URL',
        'Error: Integration suites require isolated test services: TEST_DATABASE_URL (must name a database ending in _test)',
        'Error: Integration suites require isolated test services: TEST_REDIS_URL',
      ],
    });
  });
});
