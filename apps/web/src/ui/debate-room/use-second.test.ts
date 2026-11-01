import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  calibratedNowMs,
  createRoundTime,
  MAX_SAMPLE_RTT_MS,
  type RoundTimeSample,
} from './use-second';

setupRitewayBun();

const sample = (overrides: Partial<RoundTimeSample> = {}): RoundTimeSample => ({
  serverNowMs: 10_000,
  sentAtMs: 0,
  receivedAtMs: 0,
  generation: 1,
  ...overrides,
});

describe('calibratedNowMs', () => {
  test('two-minute-fast browser wall clock shows the server-authoritative remaining duration', () => {
    const serverAtReceive = 60_000; // the browser is two minutes fast: it never enters the projection
    const serverSample = sample({
      serverNowMs: serverAtReceive,
      sentAtMs: 0,
      receivedAtMs: 0,
      generation: 1,
    });
    const monotonic700 = 700; // 0.7s later, measured independently of wall clock
    assert({
      given: 'a browser clock that is two minutes fast',
      should: 'project pure server time, never wall time',
      actual: calibratedNowMs(serverSample, monotonic700),
      expected: serverAtReceive + 700,
    });
  });
});

describe('createRoundTime', () => {
  test('projection uses the monotonic elapsed since receive, not the computer clock', () => {
    let mono = 1000;
    const clock = createRoundTime({ monotonicNowMs: () => mono });
    clock.sample(
      sample({ serverNowMs: 60_000, sentAtMs: 0, receivedAtMs: 1000, generation: 2 }),
    );
    const first = clock.nowMs();
    mono += 30_000;
    assert({
      given: 'a computer-clock skew of minutes during one-second ticks',
      should: 'advance exactly one monotonic delta per tick',
      actual: [first, clock.nowMs()],
      expected: [60_500, 90_500], // midpoint RTT estimate: rtt 1000ms -> +500
    });
  });

  test('latency envelope: an ordinary high-latency sample is accepted, a worse one rejected', () => {
    const clock = createRoundTime({ monotonicNowMs: () => 0 });
    assert({
      given: `samples at the policy edge and beyond (${MAX_SAMPLE_RTT_MS}ms RTT)`,
      should: 'accept the useful calibration and refuse the uncertain one',
      actual: [
        clock.sample(
          sample({ sentAtMs: 0, receivedAtMs: MAX_SAMPLE_RTT_MS - 1, generation: 5 }),
        ),
        clock.sample(
          sample({ sentAtMs: 0, receivedAtMs: MAX_SAMPLE_RTT_MS + 1, generation: 6 }),
        ),
      ],
      expected: [true, false],
    });
  });

  test('stale and out-of-order deliveries cannot replace a newer generation', () => {
    let mono = 0;
    const clock = createRoundTime({ monotonicNowMs: () => mono });
    clock.sample(sample({ serverNowMs: 50_000, generation: 3 }));
    mono = 10;
    const rejected = clock.sample(
      sample({ serverNowMs: 70_000, generation: 2 }), // older read, arrives late
    );
    assert({
      given: 'an older request arriving after a newer generation was accepted',
      should: 'keep the accepted newer sample',
      actual: [rejected, clock.nowMs()],
      expected: [false, 50_010],
    });
  });

  test('accepting a fresh same-version sample re-anchors atomically (no double counting)', () => {
    let mono = 0;
    const clock = createRoundTime({ monotonicNowMs: () => mono });
    clock.sample(sample({ serverNowMs: 30_000, generation: 1 }));
    mono = 500;
    clock.sample(
      sample({ serverNowMs: 31_000, generation: 2, receivedAtMs: 500 }),
    );
    assert({
      given: 'a periodic resample that carries an unchanged Round version',
      should: 'keep time continuous rather than jumping by elapsed-since-seed',
      actual: clock.nowMs(),
      expected: 31_250, // 31,000 ms sample; a 500 ms RTT projects it to receive with +250 ms (RTT/2)
    });
  });

  test('rollback prevention: a lower accepted sample cannot move time backwards', () => {
    let mono = 0;
    const clock = createRoundTime({ monotonicNowMs: () => mono });
    clock.sample(sample({ serverNowMs: 90_000, generation: 4, receivedAtMs: 0 }));
    mono = 10;
    const rejected = clock.sample(
      sample({ serverNowMs: 20_000, generation: 5, receivedAtMs: 10 }),
    );
    assert({
      given: 'a fresh generation reporting a much earlier server instant',
      should: 'be refused as an authority rollback',
      actual: [rejected, clock.nowMs()],
      expected: [false, 90_010],
    });
  });

  test('uncertainty is half the measured RTT', () => {
    const mono = 0;
    const clock = createRoundTime({ monotonicNowMs: () => mono });
    clock.sample(sample({ sentAtMs: 100, receivedAtMs: 400, generation: 7 }));
    assert({
      given: 'a sample measured inside a 300ms request interval',
      should: 'report ±150ms uncertainty bound',
      actual: clock.currentUncertaintyMs(),
      expected: 150,
    });
  });

  test('hydration seed is a one-time anchor that monotonic resample replaces', () => {
    let mono = 0;
    const clock = createRoundTime({ monotonicNowMs: () => mono });
    const at = 5;
    clock.sample(
      sample({ serverNowMs: 10_000, sentAtMs: at, receivedAtMs: at, generation: 0 }),
    );
    mono = 5;
    const accepted = clock.sample(
      sample({ serverNowMs: 40_000, sentAtMs: 0, receivedAtMs: 5, generation: 8 }),
    );
    assert({
      given: 'the SSR seed and then a fresh authorized read',
      should: 'replace the seed and report the fresh sample',
      actual: [accepted, clock.nowMs()],
      expected: [true, 40_002.5], // midpoint RTT estimate: rtt 5ms balances the sample
    });
  });
});
