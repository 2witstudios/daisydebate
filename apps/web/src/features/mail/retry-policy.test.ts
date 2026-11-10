import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  MAIL_LEASE_MS,
  MAIL_MAX_ATTEMPTS,
  MAIL_QUEUE_BATCH,
  mailRetryDelayMs,
  retryOrFail,
} from './retry-policy';

setupRitewayBun();

test('mail retries back off from 30 seconds to an hour', () => {
  assert({
    given: 'each attempt up to the last',
    should: 'double the wait from 30 seconds and cap it at one hour',
    actual: Array.from({ length: MAIL_MAX_ATTEMPTS }, (_, index) =>
      mailRetryDelayMs(index + 1),
    ),
    expected: [
      30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000,
    ],
  });
});

test('a queue batch fits inside its lease', () => {
  assert({
    given: 'the lease cap and a claim’s worst-case send',
    should:
      'claim no more than one lease can carry when sent one after another',
    actual: {
      lease: MAIL_LEASE_MS,
      batch: MAIL_QUEUE_BATCH,
      fits: MAIL_QUEUE_BATCH * 15_000 + 10_000 <= MAIL_LEASE_MS,
    },
    expected: { lease: 60_000, batch: 3, fits: true },
  });
});

test('retryOrFail()', () => {
  const now = '2026-11-10T00:00:00.000Z';
  assert({
    given: 'a failed first attempt, then one at the attempt cap',
    should: 'retry after the backoff, then fail for good with the same code',
    actual: [
      retryOrFail(1, now, 'delivery'),
      retryOrFail(MAIL_MAX_ATTEMPTS, now, 'delivery-unknown'),
    ],
    expected: [
      {
        kind: 'retry',
        errorCode: 'delivery',
        nextAttemptAt: '2026-11-10T00:00:30.000Z',
      },
      { kind: 'failed', errorCode: 'delivery-unknown' },
    ],
  });
});
