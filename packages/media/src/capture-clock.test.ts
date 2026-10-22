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
