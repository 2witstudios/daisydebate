import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createCaptureClock } from './capture-clock';
setupRitewayBun();
const calibration = {
  sentAtMs: 0,
  receivedAtMs: 1,
  serverNowMs: 10000,
  precisionMs: 1,
};
const frame = (
  sequence: number,
  beforeMs: number,
  afterMs = beforeMs + 0.1,
) => ({ sequence, beforeMs, afterMs });
test('capture cadence rejects bootstrap, burst and stalled observations without retimestamping', () => {
  const clock = createCaptureClock(calibration);
  const bootstrap = clock.observe(frame(0, 10));
  const paced = clock.observe(frame(1, 20.2));
  const burst = clock.observe(frame(2, 20.4));
  const resumed = clock.observe(frame(3, 30.6));
  const stalled = clock.observe(frame(4, 250));
  const queued = clock.observe(frame(5, 250.2));
  assert({
    given: 'actual callback brackets with early bursts and a 200ms stall',
    should: 'drop uncertainty anchors while preserving paced windows',
    actual: {
      bootstrap,
      burst,
      stalled,
      queued,
      paced: paced !== null,
      resumed: resumed !== null,
    },
    expected: {
      bootstrap: null,
      burst: null,
      stalled: null,
      queued: null,
      paced: true,
      resumed: true,
    },
  });
  assert({
    given: 'a retained callback bracket',
    should:
      'keep outward server bounds covering the full nominal period and raw observation',
    actual: paced && {
      before: paced.beforeMs <= 10009.1,
      after: paced.afterMs >= 10021.3,
    },
    expected: { before: true, after: true },
  });
});
test('sequence gaps and stale calibration cannot authorize queued frames', () => {
  const clock = createCaptureClock(calibration);
  clock.observe(frame(0, 10));
  const gap = clock.observe(frame(2, 20.2));
  const stale = clock.observe(frame(3, 30002));
  const stillStale = clock.observe(frame(4, 30012.2));
  assert({
    given: 'a missing raw frame then a calibration older than 30 seconds',
    should: 'return gaps instead of sample credit',
    actual: [gap, stale, stillStale],
    expected: [null, null, null],
  });
});
test('refresh preserves a valid anchor and discontinuity forces a fresh observation anchor', () => {
  const clock = createCaptureClock(calibration);
  clock.observe(frame(0, 10));
  clock.observe(frame(1, 20.2));
  clock.refresh({
    sentAtMs: 21,
    receivedAtMs: 22,
    serverNowMs: 10021,
    precisionMs: 1,
  });
  const refreshed = clock.observe(frame(2, 30.4));
  clock.refresh({
    sentAtMs: 31,
    receivedAtMs: 32,
    serverNowMs: 20000,
    precisionMs: 1,
  });
  const discontinuous = clock.observe(frame(3, 40.6));
  assert({
    given: 'an intersecting refresh then an impossible server clock jump',
    should: 'retain continuity only for intersecting calibration',
    actual: [refreshed !== null, discontinuous],
    expected: [true, null],
  });
});

/** Feeds `count` callbacks 10 ms apart with the given jitter; returns which ones the clock refused. */
const refusedOf = (
  clock: ReturnType<typeof createCaptureClock>,
  from: number,
  count: number,
  jitter: (i: number) => number = () => 0,
  start = 10,
) =>
  Array.from({ length: count }, (_, i) => from + i).filter(
    (sequence, i) =>
      clock.observe(frame(sequence, start + i * 10 + jitter(i))) === null,
  );

test('steady 10 ms callbacks recover at once after a re-anchor (ISSUE-485)', () => {
  const clock = createCaptureClock(calibration);
  const before = refusedOf(clock, 0, 100);
  // Sequence 100 never arrives: the clock re-anchors at 101.
  const after = refusedOf(clock, 101, 100, () => 0, 1020);
  assert({
    given:
      'steady callbacks exactly 10 ms apart, each with a 0.1 ms bracket, before and after one missing frame',
    should:
      'drop only the bootstrap and the re-anchor callback, then keep every steady frame',
    actual: { before, after },
    expected: { before: [0], after: [101] },
  });
});

test('jittered callbacks do not re-anchor repeatedly, and a queued burst is still refused (ISSUE-485)', () => {
  const jitter = [2.6, 0.4, 1.9, 0.1, 3, 1.1, 0.7, 2.2];
  const clock = createCaptureClock(calibration);
  const jittered = refusedOf(clock, 0, 300, (i) => jitter[i % jitter.length]!);
  const burst = createCaptureClock(calibration);
  refusedOf(burst, 0, 10);
  const queued = [10, 11, 12].map(
    (sequence) => burst.observe(frame(sequence, 110.2)) === null,
  );
  assert({
    given:
      'three seconds of callbacks with up to 3 ms of jitter, anchored on a late one, then three callbacks handed over at once',
    should:
      'refuse only the bootstrap under jitter, and refuse the queued frames that arrive a whole period early',
    actual: { jittered, queued },
    expected: { jittered: [0], queued: [false, true, true] },
  });
});
