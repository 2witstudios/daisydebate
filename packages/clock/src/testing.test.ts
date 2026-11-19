import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { virtualClock } from './testing';

setupRitewayBun();

describe('virtualClock', () => {
  test('time stands still until the test moves it', async () => {
    const clock = virtualClock(1_000);
    const woke: number[] = [];
    void clock.sleep(50).then(() => woke.push(clock.nowMs()));
    await clock.settle();
    const before = [...woke];
    await clock.advance(49);
    const short = [...woke];
    await clock.advance(1);
    assert({
      given: 'a 50 ms sleep and time advanced 49 ms, then 1 ms',
      should: 'wake it only at its instant, reading that instant',
      actual: { before, short, woke, now: clock.nowMs() },
      expected: { before: [], short: [], woke: [1_050], now: 1_050 },
    });
  });

  test('advance wakes sleepers soonest first, and lets each run before the next', async () => {
    const clock = virtualClock();
    const order: string[] = [];
    void clock.sleep(30).then(() => order.push(`b@${clock.nowMs()}`));
    void clock.sleep(10).then(async () => {
      order.push(`a@${clock.nowMs()}`);
      // Work a wake starts sleeps again inside the same advance.
      await clock.sleep(5);
      order.push(`a2@${clock.nowMs()}`);
    });
    void clock.sleep(10).then(() => order.push(`c@${clock.nowMs()}`));
    await clock.advance(100);
    assert({
      given: 'sleeps of 30, 10 and 10 ms, the first 10 sleeping 5 more',
      should: 'wake in time order, ties as they slept, and end at the advance',
      actual: { order, now: clock.nowMs() },
      expected: { order: ['a@10', 'c@10', 'a2@15', 'b@30'], now: 100 },
    });
  });

  test('an aborted wait resolves at once and is no longer a sleeper', async () => {
    const clock = virtualClock();
    const stop = new AbortController();
    let woke = false;
    const waiting = clock.waitUntilMs(10_000, stop.signal).then(() => {
      woke = true;
    });
    stop.abort();
    await waiting;
    const already = clock.waitUntilMs(10_000, stop.signal);
    await already;
    assert({
      given: 'a wait aborted while it sleeps, and one started already aborted',
      should: 'resolve both with no time passing and leave no sleeper',
      actual: { woke, now: clock.nowMs(), sleepers: clock.sleepers() },
      expected: { woke: true, now: 0, sleepers: 0 },
    });
  });

  test('run drives timed work to its end in no real time', async () => {
    const clock = virtualClock();
    const work = async () => {
      for (let beat = 0; beat < 1_000; beat += 1) await clock.sleep(1_000);
      return clock.nowMs();
    };
    const started = performance.now();
    const ended = await clock.run(work());
    assert({
      given: 'work that sleeps a thousand seconds a second at a time',
      should: 'end at the thousandth second, well inside real time',
      actual: { ended, quick: performance.now() - started < 5_000 },
      expected: { ended: 1_000_000, quick: true },
    });
  });

  test('run refuses work that waits on nothing that will come', async () => {
    const clock = virtualClock();
    const stuck = clock.run(new Promise<void>(() => undefined));
    const message = await stuck.then(
      () => 'finished',
      (error: unknown) => (error instanceof Error ? error.message : 'odd'),
    );
    assert({
      given: 'work waiting on a promise no sleeper settles',
      should: 'fail, naming the stuck wait',
      actual: message,
      expected: 'the work waits with nothing left to wake it',
    });
  });

  test('run passes a rejection on', async () => {
    const clock = virtualClock();
    const failing = async () => {
      await clock.sleep(10);
      throw new Error('refused');
    };
    const message = await clock.run(failing()).then(
      () => 'finished',
      (error: unknown) => (error instanceof Error ? error.message : 'odd'),
    );
    assert({
      given: 'work that fails after a sleep',
      should: 'reject with its error',
      actual: message,
      expected: 'refused',
    });
  });
});
