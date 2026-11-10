import * as Sentry from '@sentry/nextjs';
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

  test('initializes once a DSN is present, naming the release it was given', () => {
    const initialized = initSentry({
      dsn: 'https://examplePublicKey@o0.ingest.sentry.io/456',
      environment: 'test',
      release: '36ada6ce3182617cca5b785a3cfbf8fd640d64d2',
    });
    assert({
      given: 'a DSN and the image commit as the release',
      should:
        'initialize the SDK for this runtime and tag every event with that commit',
      actual: {
        initialized,
        release: Sentry.getClient()?.getOptions().release,
      },
      expected: {
        initialized: true,
        release: '36ada6ce3182617cca5b785a3cfbf8fd640d64d2',
      },
    });
  });
});
