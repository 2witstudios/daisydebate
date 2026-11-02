import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sampleRoundTime } from './sample-round-time';
import { timingFixture } from './sample-round-time.test-support';
setupRitewayBun();

type Clock = { kind: 'found'; serverNowMs: number };

test('wakes during a pending read coalesce into one bounded followup', async () => {
  const { edges, roundTime, read } = timingFixture<Clock>();
  const { stop, wake } = sampleRoundTime({
    ...edges,
    read,
    roundTime,
    random: () => 0.5,
  });
  edges.answer({ kind: 'found', serverNowMs: 10000 });
  await edges.flush();
  edges.advance(30_000);
  edges.show();
  wake();
  edges.show();
  assert({
    given: 'visibility and reconnect wakes during a pending sample',
    should: 'keep only the pending read',
    actual: edges.reads(),
    expected: 2,
  });
  edges.answer({ kind: 'found', serverNowMs: 40000 });
  await edges.flush();
  assert({
    given: 'success after those wakes',
    should: 'arm one two-second followup rather than wait thirty seconds',
    actual: [edges.reads(), edges.timers(), roundTime.calibration().generation],
    expected: [2, [2000], 2],
  });
  edges.advance(2000);
  edges.answer({ kind: 'found', serverNowMs: 42000 });
  await edges.flush();
  assert({
    given: 'the followup succeeding with no further wake',
    should: 'settle at thirty seconds without a notification loop',
    actual: [edges.reads(), edges.timers(), roundTime.calibration().generation],
    expected: [3, [30000], 3],
  });
  stop();
  assert({
    given: 'the owner disposed',
    should: 'cancel all pending timers',
    actual: edges.timers(),
    expected: [],
  });
});

test('a reconnect wake samples at once while settled', async () => {
  const { edges, roundTime, read } = timingFixture<Clock>();
  const { stop, wake } = sampleRoundTime({
    ...edges,
    read,
    roundTime,
    random: () => 0.5,
  });
  edges.answer({ kind: 'found', serverNowMs: 10000 });
  await edges.flush();
  edges.advance(1000);
  wake();
  assert({
    given: 'a realtime reconnect between settled samples',
    should: 'read immediately and drop the settled timer',
    actual: [edges.reads(), edges.timers()],
    expected: [2, [2000]],
  });
  stop();
});

test('a failed pending read preserves its anchor and coalesces wakes into one recovery', async () => {
  const { edges, roundTime, read } = timingFixture<Clock>();
  const { stop } = sampleRoundTime({
    ...edges,
    read,
    roundTime,
    random: () => 0.5,
  });
  edges.answer({ kind: 'found', serverNowMs: 10000 });
  await edges.flush();
  const accepted = { ...roundTime.calibration() };
  edges.advance(1000);
  edges.show();
  edges.show();
  edges.show();
  edges.answer(new Error('Authorized read unavailable'));
  await edges.flush();
  assert({
    given: 'a read failure after repeated visibility wakes',
    should: 'keep the accepted anchor and arm one bounded recovery',
    actual: [
      edges.reads(),
      edges.timers(),
      roundTime.calibration(),
      roundTime.status().kind,
    ],
    expected: [2, [2000], accepted, 'stale'],
  });
  edges.advance(2000);
  edges.answer({ kind: 'found', serverNowMs: 13000 });
  await edges.flush();
  assert({
    given: 'success on that recovery',
    should: 'advance one generation and restore the settled cadence',
    actual: [
      edges.reads(),
      edges.timers(),
      roundTime.calibration().generation,
      roundTime.status().kind,
    ],
    expected: [3, [30000], 3, 'current'],
  });
  stop();
});
