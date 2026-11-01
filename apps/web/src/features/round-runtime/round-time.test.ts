import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createMeasuredRead,
  createRoundTime,
  decideSample,
  MAX_SAMPLE_RTT_MS,
  type RoundTimeSample,
  type SampleDecision,
} from './round-time';

setupRitewayBun();

const sample = (overrides: Partial<RoundTimeSample> = {}): RoundTimeSample => ({
  serverNowMs: 10_000,
  sentAtMs: 0,
  receivedAtMs: 0,
  generation: 1,
  ...overrides,
});

describe('decideSample', () => {
  test('a non-finite sample is refused atomically and the clock keeps its state', () => {
    const mono = 0;
    const clock = createRoundTime({ monotonicNowMs: () => mono });
    assert({
      given: 'a first real sample, then NaN server time and NaN generation',
      should: 'accept only the real one and keep projecting it',
      actual: [
        clock.sample(sample({ serverNowMs: 10_000, generation: 1 })).accepted,
        clock.sample(sample({ serverNowMs: NaN, generation: NaN })).accepted,
        clock.nowMs(),
      ],
      expected: [true, false, 10_000],
    });
  });

  test('a latency envelope beyond the policy is refused without touching the anchor', () => {
    const clock = createRoundTime({ monotonicNowMs: () => 0 });
    assert({
      given: `samples at the envelope edge (${MAX_SAMPLE_RTT_MS} ms) and beyond`,
      should: 'accept the bounded one, refuse the slower one',
      actual: [
        clock.sample(
          sample({
            sentAtMs: 0,
            receivedAtMs: MAX_SAMPLE_RTT_MS,
            generation: 1,
          }),
        ).accepted,
        clock.sample(
          sample({
            sentAtMs: 0,
            receivedAtMs: MAX_SAMPLE_RTT_MS + 1,
            generation: 2,
          }),
        ).accepted,
      ],
      expected: [true, false],
    });
  });

  test('a completion whose generation was allocated earlier cannot displace newer authority', () => {
    const mono = 100;
    const clock = createRoundTime({ monotonicNowMs: () => mono });
    clock.sample(
      sample({
        serverNowMs: 11_000,
        sentAtMs: 0,
        receivedAtMs: 100,
        generation: 2,
      }),
    );
    const newer = clock.nowMs();
    const late = clock.sample(
      sample({
        serverNowMs: 10_500,
        sentAtMs: 0,
        receivedAtMs: 100,
        generation: 1,
      }),
    );
    assert({
      given: 'an older request landing after a newer generation was accepted',
      should: 'refuse it and keep the newer projection',
      actual: [
        late.accepted,
        late.accepted ? undefined : late.refusal,
        newer,
        clock.nowMs(),
      ],
      expected: [false, 'stale-generation', 11_050, 11_050],
    });
  });

  test('a server instant behind the projected now, beyond its own uncertainty, is a rollback', () => {
    let mono = 0;
    const clock = createRoundTime({ monotonicNowMs: () => mono });
    clock.sample(sample({ serverNowMs: 10_000, generation: 1 }));
    mono = 10_000;
    const before = clock.nowMs();
    const rolled = clock.sample(
      sample({
        serverNowMs: 11_000,
        sentAtMs: 10_000,
        receivedAtMs: 10_000,
        generation: 2,
      }),
    );
    assert({
      given: 'the clock has projected to 20 000 and a sample claims 11 000',
      should: 'refuse the rollback rather than jump the display backwards',
      actual: [
        before,
        rolled.accepted,
        rolled.accepted ? undefined : rolled.refusal,
        clock.nowMs(),
      ],
      expected: [20_000, false, 'server-rollback', 20_000],
    });
  });

  test('a slower link accepts its midpoint estimate with RTT/2 uncertainty', () => {
    const clock = createRoundTime({ monotonicNowMs: () => 400 });
    const decision = clock.sample(
      sample({
        serverNowMs: 60_000,
        sentAtMs: 100,
        receivedAtMs: 400,
        generation: 3,
      }),
    );
    assert({
      given: 'a sample measured inside a 300 ms request interval',
      should: 'anchor at receive with the midpoint estimate and honest bound',
      actual: [
        decision.accepted,
        clock.nowMs(),
        clock.calibration()?.uncertaintyMs,
      ],
      expected: [true, 60_150, 150],
    });
  });

  test('the hydration seed only projects until a real authorized sample replaces it', () => {
    let mono = 5;
    const clock = createRoundTime({
      monotonicNowMs: () => mono,
      hydrationSeedServerMs: 10_000,
    });
    assert({
      given: 'a mounted room before its first authorized read lands',
      should: 'project from the seed and report it is not yet real',
      actual: [clock.nowMs(), clock.calibration()?.real],
      expected: [10_000, false],
    });
    mono = 2_000;
    const accepted = clock.sample(
      sample({
        serverNowMs: 41_000,
        sentAtMs: 0,
        receivedAtMs: 2_000,
        generation: 1,
      }),
    );
    assert({
      given: 'the first authorized sample arrives',
      should: 'replace the seed and mark the calibration real',
      actual: [accepted.accepted, clock.nowMs(), clock.calibration()?.real],
      expected: [true, 42_000, true],
    });
  });
});

describe('createMeasuredRead', () => {
  test('server-action-shaped reads: only the server instant is needed, interval measured here', async () => {
    // The server process's monotonic epoch is unrelated to the client's; the
    // read contract carries only the server's millisecond instant.
    let mono = 1_000;
    const clock = createRoundTime({ monotonicNowMs: () => mono });
    const read = createMeasuredRead({
      read: async () =>
        ({ kind: 'found', serverNowMs: 90_000, extra: 'view' }) as const,
      roundTime: clock,
      monotonicNowMs: () => mono,
      nextGeneration: (() => {
        let last = 0;
        return () => ++last;
      })(),
    });
    const started = read();
    mono = 1_200; // the response lands, then its body parse delay elapses
    const response = await started;
    mono = 1_300;
    assert({
      given: 'an in-process read whose body parse delay lands after receive',
      should:
        'answer the caller unchanged and calibrate on the measured interval',
      actual: [
        response,
        clock.calibration()?.serverAtReceiveMs,
        clock.calibration()?.monoAtReceiveMs,
        clock.nowMs(),
      ],
      expected: [
        { kind: 'found', serverNowMs: 90_000, extra: 'view' },
        90_100,
        1_200,
        90_200,
      ],
    });
  });

  test('reordered concurrent reads keep their request-start generations', async () => {
    let mono = 0;
    const clock = createRoundTime({ monotonicNowMs: () => mono });
    let generation = 0;
    const pending = new Map<number, ((value: number) => void)[]>();
    const read = createMeasuredRead({
      read: () =>
        new Promise<{ kind: 'found'; serverNowMs: number }>((resolve) => {
          const g = generation;
          const waiters = pending.get(g) ?? [];
          waiters.push((serverNowMs) =>
            resolve({ kind: 'found', serverNowMs }),
          );
          pending.set(g, waiters);
        }),
      roundTime: clock,
      monotonicNowMs: () => mono,
      nextGeneration: () => ++generation,
    });
    const first = read(); // generation 1, would resolve later with older time
    const second = read(); // generation 2, resolves first with newer time
    mono = 50;
    pending.get(2)![0]!(30_000);
    await second;
    const fresh = clock.nowMs();
    mono = 100;
    pending.get(1)![0]!(25_000);
    await first;
    assert({
      given: 'two concurrent reads whose completions arrive out of order',
      should: 'keep the newer accepted sample and refuse the late older one',
      actual: [fresh, clock.nowMs(), clock.calibration()?.generation],
      expected: [30_025, 30_075, 2],
    });
  });

  test('a refusal leaves the accepted anchor untouched', async () => {
    let mono = 0;
    const clock = createRoundTime({ monotonicNowMs: () => mono });
    clock.sample(sample({ serverNowMs: 50_000, generation: 5 }));
    mono = 500;
    let decision: SampleDecision | null = null;
    const read = createMeasuredRead({
      read: async () => ({ kind: 'found', serverNowMs: 10_000 }) as const,
      roundTime: {
        ...clock,
        sample: (candidate) => {
          decision = clock.sample(candidate);
          return decision;
        },
      },
      monotonicNowMs: () => mono,
      nextGeneration: (() => {
        let last = 5;
        return () => ++last;
      })(),
    });
    const before = clock.nowMs();
    await read();
    assert({
      given: 'a read reporting a server instant far behind the projection',
      should: 'keep projecting from the accepted anchor',
      actual: [before, clock.nowMs(), decision],
      expected: [
        50_500,
        50_500,
        { accepted: false, refusal: 'server-rollback' },
      ],
    });
  });
});

describe('decideSample pure boundary', () => {
  test('interval boundaries are inclusive at zero and exclusive beyond the envelope', () => {
    assert({
      given:
        'an instantaneous interval and an interval one millisecond too long',
      should: 'accept the first and refuse the second',
      actual: [
        decideSample(
          null,
          sample({ sentAtMs: 7, receivedAtMs: 7, generation: 1 }),
        ).accepted,
        decideSample(
          null,
          sample({ sentAtMs: 0, receivedAtMs: -1, generation: 2 }),
        ).accepted,
      ],
      expected: [true, false],
    });
  });
});
