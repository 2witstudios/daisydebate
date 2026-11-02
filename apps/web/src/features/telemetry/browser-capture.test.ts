import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  browserCaptureAttributes,
  browserCaptureConfig,
} from './browser-capture';

setupRitewayBun();

const DSN = 'https://examplePublicKey@o0.ingest.sentry.io/456';

describe('browser capture configuration (ISSUE-1008)', () => {
  test('writes attributes only for a configured DSN', () => {
    assert({
      given: 'no DSN, even with an environment',
      should: 'write nothing, so the browser stays inert',
      actual: browserCaptureAttributes({ SENTRY_ENVIRONMENT: 'staging' }),
      expected: {},
    });
    assert({
      given: 'a DSN and an environment',
      should: 'write both',
      actual: browserCaptureAttributes({
        NEXT_PUBLIC_SENTRY_DSN: DSN,
        SENTRY_ENVIRONMENT: 'staging',
      }),
      expected: {
        'data-sentry-dsn': DSN,
        'data-sentry-environment': 'staging',
      },
    });
  });

  test('reads back what the layout wrote', () => {
    assert({
      given: 'the html dataset of a configured page',
      should: 'give the client its DSN and environment tag',
      actual: browserCaptureConfig({
        sentryDsn: DSN,
        sentryEnvironment: 'staging',
      }),
      expected: { dsn: DSN, environment: 'staging' },
    });
    assert({
      given: 'the html dataset of an unconfigured page',
      should: 'give the client no DSN',
      actual: browserCaptureConfig({}),
      expected: { dsn: undefined, environment: undefined },
    });
  });
});
