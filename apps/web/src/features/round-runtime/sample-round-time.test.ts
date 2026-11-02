import { assert, setupRitewayBun, test } from 'riteway/bun';
import { driverEdges } from '../resource-sync/driver.test-support';
import { createMeasuredRead, createRoundTime } from './round-time';
import { sampleRoundTime } from './sample-round-time';
import { timingFixture } from './sample-round-time.test-support';
setupRitewayBun();

test('seed failures retry serially, a live sample settles the cadence and stop disposes', async () => {
  const { edges, roundTime, read } = timingFixture<
    { kind: 'found'; serverNowMs: number } | { kind: 'unavailable' }
  >(10_000);
  const { stop } = sampleRoundTime({
    ...edges,
    read,
    roundTime,
    random: () => 0.5,
  });
  edges.show();
  edges.show();
  assert({
    given: 'a pending initial read and repeated wakeups',
    should: 'keep one outstanding read under its one deadline',
    actual: [edges.reads(), edges.timers(), roundTime.status()],
    expected: [1, [2000], { kind: 'seed', uncertaintyMs: null }],
  });
  edges.answer({ kind: 'unavailable' });
  await edges.flush();
  assert({
    given: 'failed seed read after those wakes',
    should: 'arm one fast retry and release the read deadline',
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
  edges.advance(30_000);
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

test('unmount aborts the sampling read lifetime and discards its late calibration', async () => {
  const edges = driverEdges<{ kind: 'found'; serverNowMs: number }>();
  const roundTime = createRoundTime({
    monotonicNowMs: edges.scheduler.now,
    hydrationSeedServerMs: 10000,
  });
  const measured = createMeasuredRead({
    read: edges.read,
    roundTime,
  });
  let receivedSignal: AbortSignal | undefined;
  const { stop } = sampleRoundTime({
    ...edges,
    roundTime,
    random: () => 0.5,
    read: (signal) => {
      receivedSignal = signal;
      return measured(signal);
    },
  });
  edges.show();
  edges.show();
  stop();
  edges.answer({ kind: 'found', serverNowMs: 20000 });
  await edges.flush();
  assert({
    given:
      'a stopped owner with coalesced visibility wakes whose server action finishes later',
    should: 'abort its client lifetime, discard calibration and leave no retry',
    actual: [
      receivedSignal?.aborted,
      roundTime.status().kind,
      roundTime.nowMs(),
      edges.timers(),
      edges.reads(),
    ],
    expected: [true, 'seed', 10000, [], 1],
  });
});
