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
      expected: { dsn: DSN, environment: 'staging', release: undefined },
    });
    assert({
      given: 'the html dataset of an unconfigured page',
      should: 'give the client no DSN',
      actual: browserCaptureConfig({}),
      expected: { dsn: undefined, environment: undefined, release: undefined },
    });
  });

  test('carries the release the server reports', () => {
    const commit = '36ada6ce3182617cca5b785a3cfbf8fd640d64d2';
    assert({
      given: 'a DSN and the image commit',
      should: 'write the commit as the release',
      actual: browserCaptureAttributes({
        NEXT_PUBLIC_SENTRY_DSN: DSN,
        GIT_COMMIT: commit,
      }),
      expected: { 'data-sentry-dsn': DSN, 'data-sentry-release': commit },
    });
    assert({
      given: 'the unknown commit default, or a commit with no DSN',
      should: 'write no release',
      actual: [
        browserCaptureAttributes({
          NEXT_PUBLIC_SENTRY_DSN: DSN,
          GIT_COMMIT: 'unknown',
        }),
        browserCaptureAttributes({ GIT_COMMIT: commit }),
      ],
      expected: [{ 'data-sentry-dsn': DSN }, {}],
    });
    assert({
      given: 'the html dataset of a page with a release',
      should: 'give the client that release',
      actual: browserCaptureConfig({ sentryDsn: DSN, sentryRelease: commit }),
      expected: { dsn: DSN, environment: undefined, release: commit },
    });
  });
});
