import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sentryRelease } from './sentry-release';

setupRitewayBun();

describe('sentryRelease', () => {
  test('the release is the image commit, or nothing', () => {
    assert({
      given: 'the image GIT_COMMIT, its unset default, and no value',
      should:
        'name the commit, and give no release for the unknown default or an absent value',
      actual: [
        sentryRelease('36ada6ce3182617cca5b785a3cfbf8fd640d64d2'),
        sentryRelease('unknown'),
        sentryRelease(''),
        sentryRelease(undefined),
      ],
      expected: [
        '36ada6ce3182617cca5b785a3cfbf8fd640d64d2',
        undefined,
        undefined,
        undefined,
      ],
    });
  });
});
