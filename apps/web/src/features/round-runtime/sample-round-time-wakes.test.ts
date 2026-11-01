import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sampleRoundTime } from './sample-round-time';
import { timingFixture } from './sample-round-time.test-support';
setupRitewayBun();

test('visibility wakes during a pending recovery coalesce one bounded followup before settling', async () => {
  const { createRoundSyncDriver, seedRoundSync } =
    await import('./round-sync-driver');
  const { round } = await import('../room-runtime/operations.test-support');
  const { edges, roundTime, read } =
    timingFixture<import('./read-round').RoundRead>();
  const stop = sampleRoundTime({ ...edges, read, roundTime });
  edges.answer({ kind: 'found', round, serverNowMs: 10000, socketUrl: null });
  await edges.flush();
  const driver = createRoundSyncDriver({
    ...edges,
    visibility: { isVisible: () => true, onVisible: () => () => {} },
    seed: seedRoundSync(round, edges.scheduler.now()),
    read,
  });
  driver.signal();
  edges.answer({ kind: 'unavailable', socketUrl: null });
  await edges.flush();
  edges.advance(2000);
  edges.show();
  edges.show();
  assert({
    given:
      'a real resource failure and two visibility wakes during the recovery sample',
    should: 'keep only the pending sample until it finishes',
    actual: edges.reads(),
    expected: 3,
  });
  edges.answer({ kind: 'found', round, serverNowMs: 12000, socketUrl: null });
  await edges.flush();
  assert({
    given: 'success after those pending visibility wakes',
    should:
      'retain one bounded two-second followup instead of dropping the wakes for thirty seconds',
    actual: [
      edges.reads(),
      edges.timers().sort((a, b) => a - b),
      roundTime.calibration()?.generation,
    ],
    expected: [3, [2000, 3000], 3],
  });
  edges.advance(2000);
  edges.answer({ kind: 'found', round, serverNowMs: 14000, socketUrl: null });
  await edges.flush();
  assert({
    given:
      'the single coalesced followup succeeds without another external wake',
    should:
      'settle at thirty seconds without self-notification reentry or generation reset',
    actual: [
      edges.reads(),
      edges.timers().sort((a, b) => a - b),
      roundTime.calibration()?.generation,
    ],
    expected: [4, [1000, 30000], 4],
  });
  driver.dispose();
  stop();
  assert({
    given: 'both real owners disposed',
    should: 'cancel all pending timers',
    actual: edges.timers(),
    expected: [],
  });
});

test('a failed pending read preserves its anchor and coalesces external wakes into one recovery', async () => {
  const { edges, roundTime, read } = timingFixture<{
    kind: 'found';
    serverNowMs: number;
  }>();
  const stop = sampleRoundTime({ ...edges, read, roundTime });
  edges.answer({ kind: 'found', serverNowMs: 10000 });
  await edges.flush();
  const accepted = { ...roundTime.calibration() };
  edges.show();
  edges.show();
  edges.show();
  edges.answer(new Error('Authorized read unavailable'));
  await edges.flush();
  assert({
    given:
      'a read failure after repeated visibility wakes during that pending read',
    should:
      'keep the accepted anchor and arm only one bounded recovery without self-notification reentry',
    actual: [
      edges.reads(),
      edges.timers(),
      roundTime.calibration(),
      roundTime.status().kind,
    ],
    expected: [2, [2000], accepted, 'stale'],
  });
  edges.advance(2000);
  edges.answer({ kind: 'found', serverNowMs: 12000 });
  await edges.flush();
  assert({
    given:
      'success on the one coalesced recovery without further visibility wakes',
    should: 'advance generation once and restore the ordinary cadence',
    actual: [
      edges.reads(),
      edges.timers(),
      roundTime.calibration()?.generation,
      roundTime.status().kind,
    ],
    expected: [3, [30000], 3, 'current'],
  });
  stop();
});
