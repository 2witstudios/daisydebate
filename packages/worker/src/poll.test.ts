import { virtualClock } from '@daisy/clock/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { LoopPass } from './backoff';
import { pollWork, type WorkWake } from './poll';

setupRitewayBun();

const manualWake = () => {
  const listeners = new Set<() => void>();
  const wake: WorkWake = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    wake,
    signal: () => listeners.forEach((listener) => listener()),
    listeners: () => listeners.size,
  };
};

/** A pass that records when each pass started and answers from `found`. */
const recorder = (
  clock: ReturnType<typeof virtualClock>,
  found: (index: number) => LoopPass | Error = () => 'idle',
) => {
  const startedAt: number[] = [];
  return {
    startedAt,
    pass: async () => {
      const outcome = found(startedAt.length);
      startedAt.push(clock.nowMs());
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
};

const backoff = { busyMs: 100, idleMaxMs: 800 };

test('an idle worker backs off to its cap; a pass that works resets it', async () => {
  const clock = virtualClock();
  const passes = recorder(clock, (index) => (index === 6 ? 'worked' : 'idle'));
  const worker = pollWork({
    waits: clock,
    backoff,
    pass: passes.pass,
    failed: () => undefined,
  });
  await worker.started;
  await clock.advance(4_000);
  await worker.stop();
  assert({
    given: 'empty passes, then one that works, then empty ones',
    should:
      'wait 100, 200, 400, 800, 800, 800, then 100 after the working pass, then grow again',
    actual: passes.startedAt.slice(0, 10),
    expected: [0, 100, 300, 700, 1_500, 2_300, 3_100, 3_200, 3_400, 3_800],
  });
});

test('a wake brings the next pass forward, never sooner than the busy interval', async () => {
  const clock = virtualClock();
  const signals = manualWake();
  const passes = recorder(clock);
  const worker = pollWork({
    waits: clock,
    backoff,
    pass: passes.pass,
    failed: () => undefined,
    wake: signals.wake,
  });
  await clock.advance(1_000); // passes at 0, 100, 300, 700; waiting for 1_500
  signals.signal();
  await clock.settle();
  const woken = [...passes.startedAt];
  await clock.advance(30); // pass at 1_000, next wait is 100
  signals.signal(); // 30 ms after a pass started: paced to 1_100
  await clock.advance(100);
  await worker.stop();
  assert({
    given: 'a wake during a long idle wait',
    should: 'pass at once',
    actual: woken,
    expected: [0, 100, 300, 700, 1_000],
  });
  assert({
    given:
      'a wake 30 ms after the last pass started, with a busy interval of 100',
    should: 'pass 100 ms after that pass started, not at once',
    actual: passes.startedAt.slice(5),
    expected: [1_100],
  });
});

test('wakes during a pass coalesce into one following pass', async () => {
  const clock = virtualClock();
  const signals = manualWake();
  let release = () => {};
  const startedAt: number[] = [];
  const worker = pollWork({
    waits: clock,
    backoff,
    pass: async () => {
      startedAt.push(clock.nowMs());
      if (startedAt.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return 'idle';
    },
    failed: () => undefined,
    wake: signals.wake,
  });
  await clock.settle();
  for (let wake = 0; wake < 5; wake += 1) signals.signal();
  await clock.advance(40);
  release();
  await clock.advance(59);
  const afterRelease = [...startedAt];
  await clock.advance(1);
  await clock.advance(150);
  await worker.stop();
  assert({
    given: 'five wakes while a slow pass runs',
    should:
      'run exactly one more pass, paced to the busy interval after the slow one started',
    actual: { afterRelease, then: startedAt },
    expected: { afterRelease: [0], then: [0, 100, 200] },
  });
});

test('a failed pass backs off and wakes do not cut that back-off short', async () => {
  const clock = virtualClock();
  const signals = manualWake();
  const failures: unknown[] = [];
  const passes = recorder(clock, (index) =>
    index < 3 ? new Error(`down ${index}`) : 'idle',
  );
  const worker = pollWork({
    waits: clock,
    backoff,
    pass: passes.pass,
    failed: (error) => failures.push(error),
    wake: signals.wake,
  });
  await clock.advance(150); // passes at 0 and 100 fail; waiting 200
  signals.signal();
  signals.signal();
  await clock.advance(150); // pass at 300 fails, then waiting 400
  await clock.advance(400);
  await worker.stop();
  assert({
    given: 'three failing passes and wakes during their back-off',
    should: 'report each failure and keep the growing back-off',
    actual: {
      startedAt: passes.startedAt,
      failures: failures.map((error) => (error as Error).message),
    },
    expected: {
      startedAt: [0, 100, 300, 700],
      failures: ['down 0', 'down 1', 'down 2'],
    },
  });
});

test('a failure sink that throws is contained', async () => {
  const clock = virtualClock();
  const passes = recorder(clock, () => new Error('down'));
  const worker = pollWork({
    waits: clock,
    backoff,
    pass: passes.pass,
    failed: () => {
      throw new Error('the reporter is down too');
    },
  });
  await clock.advance(300);
  await worker.stop();
  assert({
    given: 'failing passes reported to a sink that throws',
    should: 'keep passing on the back-off',
    actual: passes.startedAt,
    expected: [0, 100, 300],
  });
});

test('passes never overlap, however the worker is woken', async () => {
  const clock = virtualClock();
  const signals = manualWake();
  let active = 0;
  let most = 0;
  let passes = 0;
  const worker = pollWork({
    waits: clock,
    backoff,
    pass: async () => {
      passes += 1;
      active += 1;
      most = Math.max(most, active);
      await clock.sleep(250);
      active -= 1;
      return passes % 2 === 0 ? 'worked' : 'idle';
    },
    failed: () => undefined,
    wake: signals.wake,
  });
  for (let step = 0; step < 40; step += 1) {
    signals.signal();
    worker.wake();
    await clock.advance(37);
  }
  await clock.run(worker.stop());
  assert({
    given: 'wakes every 37 ms against passes that take 250 ms',
    should: 'never run two passes at once',
    actual: { most, ran: passes > 4 },
    expected: { most: 1, ran: true },
  });
});

test('stop ends a wait at once, awaits the pass in flight, and nothing passes after', async () => {
  const clock = virtualClock();
  const signals = manualWake();
  const passes = recorder(clock);
  const idle = pollWork({
    waits: clock,
    backoff,
    pass: passes.pass,
    failed: () => undefined,
    wake: signals.wake,
  });
  await clock.advance(500); // waiting 400 from 300
  const stoppedAt = clock.nowMs();
  await idle.stop();
  const sleepersAfterStop = clock.sleepers();
  signals.signal();
  await clock.advance(5_000);

  let passEnded = false;
  let sawAbort = false;
  const busy = pollWork({
    waits: clock,
    backoff,
    pass: async (signal) => {
      await clock.sleep(1_000, signal);
      sawAbort = signal.aborted;
      await clock.sleep(50);
      passEnded = true;
      return 'worked';
    },
    failed: () => undefined,
  });
  await clock.advance(200);
  const stopping = busy.stop();
  const endedBeforeStop = passEnded;
  await clock.run(stopping);
  assert({
    given: 'an idle worker stopped during its wait',
    should:
      'resolve with no time passing, leave no sleeper, unsubscribe and never pass again',
    actual: {
      at: clock.nowMs() >= stoppedAt,
      sleepersAfterStop,
      listeners: signals.listeners(),
      passes: passes.startedAt,
    },
    expected: {
      at: true,
      sleepersAfterStop: 0,
      listeners: 0,
      passes: [0, 100, 300],
    },
  });
  assert({
    given: 'a worker stopped while its pass is in flight',
    should:
      'abort the pass signal, cutting its wait short, and resolve only after the pass ends',
    actual: { endedBeforeStop, sawAbort, passEnded },
    expected: { endedBeforeStop: false, sawAbort: true, passEnded: true },
  });
});

test('an invalid back-off is refused', () => {
  const clock = virtualClock();
  let error: unknown;
  try {
    pollWork({
      waits: clock,
      backoff: { busyMs: 0, idleMaxMs: 10 },
      pass: async () => 'idle',
      failed: () => undefined,
    });
  } catch (caught) {
    error = caught;
  }
  assert({
    given: 'a busy interval of zero',
    should: 'refuse to start a loop that would spin',
    actual: (error as Error | undefined)?.message,
    expected: 'Invalid worker idle back-off',
  });
});
