import { assert, setupRitewayBun, test } from 'riteway/bun';
import { attemptBucket, attemptsExhausted, clientDigest } from './rate-limit';

setupRitewayBun();
const key = 'k'.repeat(43);

test('clientDigest', () => {
  const digest = clientDigest(key, '203.0.113.9');
  assert({
    given: 'a client address',
    should: 'store a keyed 64-hex digest that never contains the address',
    actual: [/^[0-9a-f]{64}$/.test(digest), digest.includes('203')],
    expected: [true, false],
  });
  assert({
    given: 'the same address under another key',
    should: 'produce an unrelated digest',
    actual: clientDigest('x'.repeat(43), '203.0.113.9') === digest,
    expected: false,
  });
});

test('attemptBucket', () => {
  const bucket = (purpose: 'enroll' | 'sign-in', now: string) =>
    attemptBucket({ purpose, client: 'c', now });
  assert({
    given: 'two failures in one 10-minute window',
    should: 'share a bucket',
    actual:
      bucket('sign-in', '2026-10-26T12:00:00.000Z') ===
      bucket('sign-in', '2026-10-26T12:09:59.999Z'),
    expected: true,
  });
  assert({
    given: 'the next window or another purpose',
    should: 'use a fresh bucket',
    actual: [
      bucket('sign-in', '2026-10-26T12:10:00.000Z'),
      bucket('enroll', '2026-10-26T12:00:00.000Z'),
    ],
    expected: [
      'sign-in:c:2026-10-26T12:10:00.000Z',
      'enroll:c:2026-10-26T12:00:00.000Z',
    ],
  });
});

test('attemptsExhausted', () => {
  assert({
    given: '9 and 10 recorded failures',
    should: 'allow the tenth try and refuse the eleventh',
    actual: [attemptsExhausted(9), attemptsExhausted(10)],
    expected: [false, true],
  });
});
