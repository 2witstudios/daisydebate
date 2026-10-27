import { assert, setupRitewayBun, test } from 'riteway/bun';
import { MAIL_INTENT_MAX_ATTEMPTS, mailRetryDelayMs } from './retry-policy';

setupRitewayBun();

test('mail retries back off from 30 seconds to an hour', () => {
  assert({
    given: 'each attempt up to the last',
    should: 'double the wait from 30 seconds and cap it at one hour',
    actual: Array.from({ length: MAIL_INTENT_MAX_ATTEMPTS }, (_, index) =>
      mailRetryDelayMs(index + 1),
    ),
    expected: [
      30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000,
    ],
  });
});
