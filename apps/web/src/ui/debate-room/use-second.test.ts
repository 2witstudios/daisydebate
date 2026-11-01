import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  calibratedNowMs,
  createRoundTime,
  MAX_SAMPLE_RTT_MS,
} from './use-second';

setupRitewayBun();

describe('calibratedNowMs', () => {
  test('ignores wall-clock skew', () => {
    const sample = { serverNowMs: 5000, sentAtMs: 0, receivedAtMs: 0 };
    const actual = calibratedNowMs(sample, 2000);
    assert({
      given: 'a monotonic advance of 2000ms over a server sample',
      should: 'advance server time by exactly the monotonic delta',
      actual,
      expected: 7000,
    });
  });
});

describe('createRoundTime', () => {
  test('injectable monotonic clock', () => {
    let mono = 0;
    const clock = createRoundTime({
      initial: { serverNowMs: 10000, sentAtMs: 0, receivedAtMs: 0 },
      monotonicNowMs: () => mono,
    });
    mono = 500;
    const first = clock.nowMs();
    mono = 1500;
    const second = clock.nowMs();
    assert({
      given: 'an injectable monotonic clock advancing 1000ms',
      should: 'advance calibrated now by 1000ms',
      actual: second - first,
      expected: 1000,
    });
  });

  test('rejects high-latency sample', () => {
    let mono = 0;
    const clock = createRoundTime({
      initial: { serverNowMs: 10000, sentAtMs: 0, receivedAtMs: 0 },
      monotonicNowMs: () => mono,
    });
    const ok = clock.sample({
      serverNowMs: 20000,
      sentAtMs: 10,
      receivedAtMs: 10 + MAX_SAMPLE_RTT_MS + 1,
    });
    assert({
      given: 'a sample whose RTT exceeds the policy',
      should: 'reject it',
      actual: ok,
      expected: false,
    });
  });

  test('rejects stale out-of-order sample', () => {
    let mono = 0;
    const clock = createRoundTime({
      initial: { serverNowMs: 10000, sentAtMs: 0, receivedAtMs: 0 },
      monotonicNowMs: () => mono,
    });
    clock.sample({ serverNowMs: 20000, sentAtMs: 5, receivedAtMs: 10 });
    const ok = clock.sample({ serverNowMs: 30000, sentAtMs: 1, receivedAtMs: 2 });
    assert({
      given: 'a sample older than the accepted one',
      should: 'reject it',
      actual: ok,
      expected: false,
    });
  });

  test('accepts fresh sample and updates now', () => {
    let mono = 100;
    const clock = createRoundTime({
      initial: { serverNowMs: 10000, sentAtMs: 0, receivedAtMs: 0 },
      monotonicNowMs: () => mono,
    });
    const ok = clock.sample({ serverNowMs: 20000, sentAtMs: 90, receivedAtMs: 100 });
    mono = 150;
    assert({
      given: 'a fresh low-latency sample',
      should: 'accept and move the calibrated base',
      actual: [ok, clock.nowMs()],
      expected: [true, 20050],
    });
  });
});