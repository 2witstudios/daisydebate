import { assert, setupRitewayBun, test } from 'riteway/bun';
import { driverEdges } from '../resource-sync/driver.test-support';
import { createMeasuredRead, createRoundTime } from './round-time';
import { sampleRoundTime } from './sample-round-time';
setupRitewayBun();

function timingFixture<
  T extends {
    readonly kind: 'found' | 'missing' | 'unavailable';
    readonly serverNowMs?: number | null;
  },
>(hydrationSeedServerMs?: number) {
  const edges = driverEdges<T>();
  const roundTime = createRoundTime({
    monotonicNowMs: edges.scheduler.now,
    ...(hydrationSeedServerMs === undefined ? {} : { hydrationSeedServerMs }),
  });
  let generation = 0;
  const read = createMeasuredRead({
    read: edges.read,
    roundTime,
    monotonicNowMs: edges.scheduler.now,
    nextGeneration: () => ++generation,
  });
  return {
    edges,
    roundTime,
    read,
    fail: () => roundTime.unavailable(++generation),
  };
}

test('seed failures retry serially, a live sample slows retries, visibility resamples and stop disposes', async () => {
  const { edges, roundTime, read } = timingFixture<
    { kind: 'found'; serverNowMs: number } | { kind: 'unavailable' }
  >(10_000);
  const stop = sampleRoundTime({ ...edges, read, roundTime });
  edges.show();
  edges.show();
  edges.advance(60_000);
  assert({
    given: 'a pending initial read and repeated wakeups',
    should: 'keep one outstanding read and no growing retry timers',
    actual: [edges.reads(), edges.timers(), roundTime.status()],
    expected: [1, [], { kind: 'seed', uncertaintyMs: null }],
  });
  edges.answer({ kind: 'unavailable' });
  await edges.flush();
  assert({
    given: 'failed seed read',
    should: 'schedule a fast retry',
    actual: edges.timers(),
    expected: [2000],
  });
  edges.advance(2000);
  edges.answer({ kind: 'found', serverNowMs: 100_000 });
  await edges.flush();
  assert({
    given: 'a real authorized time after a failed seed',
    should: 'be current and settle at 30 seconds',
    actual: [roundTime.status(), edges.timers()],
    expected: [{ kind: 'current', uncertaintyMs: 0 }, [30_000]],
  });
  edges.hide();
  edges.advance(30_000);
  edges.show();
  assert({
    given: 'periodic read pending when visibility returns',
    should: 'coalesce wake reads',
    actual: edges.reads(),
    expected: 3,
  });
  stop();
  edges.answer({ kind: 'unavailable' });
  await edges.flush();
  edges.show();
  edges.advance(60_000);
  assert({
    given: 'unmount during a pending sample',
    should: 'release visibility and never schedule or issue another retry',
    actual: [edges.reads(), edges.timers()],
    expected: [3, []],
  });
});

test('missing, rejected and aged evidence becomes stale without losing the accepted anchor', async () => {
  const { edges, roundTime, read } = timingFixture<{
    kind: 'found';
    serverNowMs: number | null;
  }>();
  const first = read();
  edges.answer({ kind: 'found', serverNowMs: 100_000 });
  await first;
  edges.advance(1000);
  const missing = read();
  edges.answer({ kind: 'found', serverNowMs: null });
  await missing;
  assert({
    given: 'same-version read without a sample after synchronization',
    should: 'retain projected time but report stale',
    actual: [roundTime.nowMs(), roundTime.status().kind],
    expected: [101_000, 'stale'],
  });
  const rejected = read();
  edges.advance(2001);
  edges.answer({ kind: 'found', serverNowMs: 104_000 });
  await rejected;
  assert({
    given: 'a response outside the RTT envelope',
    should: 'keep stale accepted authority',
    actual: [roundTime.nowMs(), roundTime.status().kind],
    expected: [103_001, 'stale'],
  });
  const fresh = read();
  edges.answer({ kind: 'found', serverNowMs: 103_001 });
  await fresh;
  edges.advance(32_001);
  assert({
    given: 'accepted evidence aging beyond the sampling envelope',
    should: 'report stale even without another response',
    actual: roundTime.status().kind,
    expected: 'stale',
  });
});

test('a failed concurrent resource read wakes the settled sampling retry', async () => {
  const { edges, roundTime, read, fail } = timingFixture<{
    kind: 'found';
    serverNowMs: number;
  }>();
  const stop = sampleRoundTime({ ...edges, read, roundTime });
  edges.answer({ kind: 'found', serverNowMs: 10000 });
  await edges.flush();
  edges.advance(1000);
  fail();
  assert({
    given:
      'a failed resource-sync read while the clock owner waits on its settled cadence',
    should: 'retry stale timing after2seconds instead of waiting29seconds',
    actual: [roundTime.status().kind, edges.timers()],
    expected: ['stale', [2000]],
  });
  stop();
});

test('repeated stale notifications cannot debounce the fast retry forever', async () => {
  const { edges, roundTime, read, fail } = timingFixture<{
    kind: 'found';
    serverNowMs: number;
  }>();
  const stop = sampleRoundTime({ ...edges, read, roundTime });
  edges.answer({ kind: 'found', serverNowMs: 10000 });
  await edges.flush();
  fail();
  edges.advance(500);
  fail();
  edges.advance(500);
  fail();
  assert({
    given: 'more stale notifications while a two-second retry is already armed',
    should: 'retain its original deadline',
    actual: edges.timers(),
    expected: [1000],
  });
  edges.advance(1000);
  assert({
    given: 'the original retry deadline',
    should: 'start one read with no synchronous reentry',
    actual: [edges.reads(), edges.timers()],
    expected: [2, []],
  });
  edges.show();
  edges.show();
  edges.answer({ kind: 'found', serverNowMs: 12000 });
  await edges.flush();
  assert({
    given: 'success from that retry and notifications during completion',
    should:
      'restore30seconds without resetting request generations or duplicating reads',
    actual: [
      edges.reads(),
      edges.timers(),
      roundTime.calibration()?.generation,
    ],
    expected: [2, [30000], 5],
  });
  stop();
});

test('unmount aborts the sampling read lifetime and discards its late calibration', async () => {
  const edges = driverEdges<{ kind: 'found'; serverNowMs: number }>();
  const roundTime = createRoundTime({
    monotonicNowMs: edges.scheduler.now,
    hydrationSeedServerMs: 10000,
  });
  const measured = createMeasuredRead({
    read: edges.read,
    roundTime,
    monotonicNowMs: edges.scheduler.now,
    nextGeneration: () => 1,
  });
  let receivedSignal: AbortSignal | undefined;
  const stop = sampleRoundTime({
    ...edges,
    roundTime,
    read: (signal) => {
      receivedSignal = signal;
      return measured(signal);
    },
  });
  stop();
  edges.answer({ kind: 'found', serverNowMs: 20000 });
  await edges.flush();
  assert({
    given: 'a stopped owner whose server action finishes later',
    should: 'abort its client lifetime, discard calibration and leave no retry',
    actual: [
      receivedSignal?.aborted,
      roundTime.status().kind,
      roundTime.nowMs(),
      edges.timers(),
    ],
    expected: [true, 'seed', 10000, []],
  });
});

test('an actual resource-sync failure publishes clock staleness and wakes the serial sampler', async () => {
  const { createRoundSyncDriver, seedRoundSync } =
    await import('./round-sync-driver');
  const { round } = await import('../room-runtime/operations.test-support');
  const edges = driverEdges<import('./read-round').RoundRead>();
  const roundTime = createRoundTime({ monotonicNowMs: edges.scheduler.now });
  let generation = 0;
  const read = createMeasuredRead({
    read: edges.read,
    roundTime,
    monotonicNowMs: edges.scheduler.now,
    nextGeneration: () => ++generation,
  });
  const stop = sampleRoundTime({
    ...edges,
    visibility: { isVisible: () => true, onVisible: () => () => {} },
    read,
    roundTime,
  });
  edges.answer({ kind: 'found', round, serverNowMs: 10000, socketUrl: null });
  await edges.flush();
  const driver = createRoundSyncDriver({
    ...edges,
    seed: seedRoundSync(round, edges.scheduler.now()),
    read,
  });
  driver.signal();
  edges.answer({ kind: 'unavailable', socketUrl: null });
  await edges.flush();
  assert({
    given:
      'the production Round driver receives an unavailable authorized read',
    should:
      'publish stale clock evidence and arm the sampler at2seconds alongside resource polling',
    actual: [roundTime.status().kind, edges.timers().sort((a, b) => a - b)],
    expected: ['stale', [2000, 5000]],
  });
  edges.advance(2000);
  assert({
    given: 'that sampling deadline',
    should: 'issue exactly one followup through the measured production reader',
    actual: edges.reads(),
    expected: 3,
  });
  edges.answer({ kind: 'found', round, serverNowMs: 12000, socketUrl: null });
  await edges.flush();
  assert({
    given: 'success on the same Round version',
    should:
      'restore current timing and30second sample cadence without reentering',
    actual: [
      roundTime.status().kind,
      roundTime.calibration()?.generation,
      edges.timers().includes(30000),
      edges.reads(),
    ],
    expected: ['current', 3, true, 3],
  });
  driver.dispose();
  stop();
  roundTime.unavailable(4);
  assert({
    given: 'both owners disposed before a further clock notification',
    should: 'leave no timer subscriptions alive',
    actual: edges.timers(),
    expected: [],
  });
});
