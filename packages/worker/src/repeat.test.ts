import { virtualClock } from '@daisy/clock/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { repeatEvery } from './repeat';

setupRitewayBun();

test('runs fall on the cadence and a run due while one is going is skipped', async () => {
  const clock = virtualClock();
  const startedAt: number[] = [];
  let active = 0;
  let most = 0;
  const worker = repeatEvery({
    waits: clock,
    everyMs: 100,
    run: async () => {
      startedAt.push(clock.nowMs());
      active += 1;
      most = Math.max(most, active);
      // The second run takes 250 ms: the runs due at 300 and 400 are skipped.
      if (startedAt.length === 2) await clock.sleep(250);
      active -= 1;
    },
    failed: () => undefined,
  });
  await clock.advance(650);
  await clock.run(worker.stop());
  assert({
    given: 'a 100 ms cadence whose second run takes 250 ms',
    should: 'start runs at 100 and 200, skip 300 and 400, resume at 500',
    actual: { startedAt, most, initial: worker.initial },
    expected: { startedAt: [100, 200, 500, 600], most: 1, initial: undefined },
  });
});

test('a start-up run waits for its dependencies, and holds the cadence off meanwhile', async () => {
  const clock = virtualClock();
  const startedAt: number[] = [];
  const ready = repeatEvery({
    waits: clock,
    everyMs: 100,
    runOnStart: true,
    ready: async () => {
      await clock.sleep(150);
      return true;
    },
    run: async () => {
      startedAt.push(clock.nowMs());
    },
    failed: () => undefined,
  });
  await clock.advance(250);
  await ready.stop();
  const skipped: number[] = [];
  const never = repeatEvery({
    waits: clock,
    everyMs: 100,
    runOnStart: true,
    ready: async () => {
      throw new Error('Redis never answered');
    },
    run: async () => {
      skipped.push(clock.nowMs());
    },
    failed: () => undefined,
  });
  await never.initial;
  await clock.advance(100);
  await never.stop();
  assert({
    given: 'dependencies that answer after 150 ms, with a 100 ms cadence',
    should: 'run once at 150, skip the run due at 100, run again at 200',
    actual: startedAt,
    expected: [150, 200],
  });
  assert({
    given: 'dependencies that never answer',
    should: 'skip the start-up run and keep the cadence',
    actual: skipped,
    expected: [350],
  });
});

test('a failing run is reported, a throwing sink is contained, and the cadence goes on', async () => {
  const clock = virtualClock();
  const failures: string[] = [];
  let runs = 0;
  const worker = repeatEvery({
    waits: clock,
    everyMs: 100,
    run: async () => {
      runs += 1;
      throw new Error(`run ${runs}`);
    },
    failed: (error) => {
      failures.push((error as Error).message);
      throw new Error('the reporter is down too');
    },
  });
  await clock.advance(300);
  await worker.stop();
  assert({
    given: 'three failing runs reported to a sink that throws',
    should: 'report each and keep running',
    actual: failures,
    expected: ['run 1', 'run 2', 'run 3'],
  });
});

test('stop ends the wait at once and awaits the run in flight', async () => {
  const clock = virtualClock();
  let sawAbort = false;
  let ended = false;
  const idle = repeatEvery({
    waits: clock,
    everyMs: 1_000,
    run: async () => undefined,
    failed: () => undefined,
  });
  await clock.advance(10);
  await idle.stop();
  const sleepers = clock.sleepers();
  const busy = repeatEvery({
    waits: clock,
    everyMs: 100,
    run: async (signal) => {
      await clock.sleep(10_000, signal);
      sawAbort = signal.aborted;
      await clock.sleep(5);
      ended = true;
    },
    failed: () => undefined,
  });
  await clock.advance(150);
  const stopping = busy.stop();
  const endedBeforeStop = ended;
  await clock.run(stopping);
  assert({
    given: 'a schedule stopped between runs, and one stopped during a run',
    should:
      'leave no sleeper, abort the run signal and resolve once the run ends',
    actual: { sleepers, endedBeforeStop, sawAbort, ended },
    expected: {
      sleepers: 0,
      endedBeforeStop: false,
      sawAbort: true,
      ended: true,
    },
  });
});
