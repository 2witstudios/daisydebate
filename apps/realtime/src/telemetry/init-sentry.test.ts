import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { initRealtimeSentry } from './init-sentry';

setupRitewayBun();

describe('initRealtimeSentry (ADR 0037 inertness gate)', () => {
  test('initializes nothing without a DSN, so this process makes no network call', () => {
    assert({
      given: 'no SENTRY_DSN',
      should: 'leave the SDK uninitialized',
      actual: initRealtimeSentry({ dsn: undefined, environment: undefined }),
      expected: false,
    });
  });

  test('initializes once a DSN is present', () => {
    assert({
      given: 'a DSN',
      should: 'initialize the SDK for this process',
      actual: initRealtimeSentry({
        dsn: 'https://examplePublicKey@o0.ingest.sentry.io/456',
        environment: 'test',
      }),
      expected: true,
    });
  });
});
