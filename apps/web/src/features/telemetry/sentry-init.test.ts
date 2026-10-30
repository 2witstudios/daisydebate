import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { initSentry } from './sentry-init';

setupRitewayBun();

describe('initSentry (ADR 0037 inertness gate)', () => {
  test('initializes nothing without a DSN, so an unconfigured deployment makes no network call', () => {
    assert({
      given: 'no SENTRY_DSN',
      should: 'leave the SDK uninitialized',
      actual: initSentry({ dsn: undefined, environment: undefined }),
      expected: false,
    });
  });

  test('initializes once a DSN is present', () => {
    assert({
      given: 'a DSN',
      should: 'initialize the SDK for this runtime',
      actual: initSentry({
        dsn: 'https://examplePublicKey@o0.ingest.sentry.io/456',
        environment: 'test',
      }),
      expected: true,
    });
  });
});
