import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  publicationClock,
  observeSourceProgress,
  refreshPublicationClock,
} from './publication-clock';

setupRitewayBun();
const calibration = { sentAtMs: 1000, receivedAtMs: 1020, serverNowMs: 10000 };

test('paced source windows preserve clock uncertainty and reject burst credit', () => {
  const clock = publicationClock({
    calibration,
    anchorMs: 1100,
    sampleRate: 48000,
  });
  const first = observeSourceProgress(clock, {
    startSample: 0,
    endSample: 480,
    beforeMs: 1110,
    afterMs: 1112,
  });
  const burst = observeSourceProgress(first.clock, {
    startSample: 480,
    endSample: 960,
    beforeMs: 1113,
    afterMs: 1114,
  });
  assert({
    given: 'a valid paced native receipt followed by an early burst receipt',
    should: 'authorize only the paced prefix and invalidate the burst anchor',
    actual: {
      firstSamples: first.clock.eligibleSamples,
      window: first.window,
      burstSamples: burst.clock.eligibleSamples,
      burstWindow: burst.window,
      valid: burst.clock.valid,
    },
    expected: {
      firstSamples: 480,
      window: { beforeMs: 10079.9888, afterMs: 10112.0112 },
      burstSamples: 480,
      burstWindow: null,
      valid: false,
    },
  });
});

test('stalls and stale calibration invalidate the anchor without crediting their consumed raw samples', () => {
  const initial = publicationClock({
    calibration,
    anchorMs: 1100,
    sampleRate: 48000,
  });
  const stalled = observeSourceProgress(initial, {
    startSample: 0,
    endSample: 480,
    beforeMs: 1110,
    afterMs: 1260,
  });
  const stale = observeSourceProgress(
    publicationClock({ calibration, anchorMs: 32000, sampleRate: 48000 }),
    { startSample: 0, endSample: 480, beforeMs: 32010, afterMs: 32011 },
  );
  const resumed = observeSourceProgress(stalled.clock, {
    startSample: 480,
    endSample: 960,
    beforeMs: 1270,
    afterMs: 1271,
  });
  assert({
    given:
      'a 150ms native callback stall, stale calibration, or a later receipt after a gap',
    should:
      'grant no eligible samples and never silently establish a new anchor',
    actual: [stalled, stale, resumed].map(({ clock, window }) => ({
      valid: clock.valid,
      eligibleSamples: clock.eligibleSamples,
      window,
    })),
    expected: Array.from({ length: 3 }, () => ({
      valid: false,
      eligibleSamples: 0,
      window: null,
    })),
  });
});

test('fresh calibration preserves a continuous anchor and a discontinuous or late clock cannot revive it', () => {
  const initial = publicationClock({
    calibration,
    anchorMs: 1100,
    sampleRate: 48000,
  });
  assert({
    given:
      'a clock refreshed inside 30 seconds, a wall-clock jump, or an expired anchor',
    should: 'preserve only the continuous calibrated timeline',
    actual: [
      refreshPublicationClock(initial, {
        sentAtMs: 16000,
        receivedAtMs: 16020,
        serverNowMs: 25000,
      }),
      refreshPublicationClock(initial, {
        sentAtMs: 16000,
        receivedAtMs: 16020,
        serverNowMs: 25200,
      }),
      refreshPublicationClock(initial, {
        sentAtMs: 32000,
        receivedAtMs: 32020,
        serverNowMs: 41000,
      }),
    ].map((clock) => ({
      valid: clock.valid,
      anchor: clock.anchorMs,
      eligibleSamples: clock.eligibleSamples,
    })),
    expected: [true, false, false].map((valid) => ({
      valid,
      anchor: 1100,
      eligibleSamples: 0,
    })),
  });
});

test('a calibration cannot authorize frames with excessive RTT, reversed time or unbounded precision', () => {
  assert({
    given: 'untrusted calibration envelopes outside the timing contract',
    should: 'refuse source credit before a publication anchor is established',
    actual: [
      { sentAtMs: 1000, receivedAtMs: 1101, serverNowMs: 10000 },
      { sentAtMs: 1100, receivedAtMs: 1000, serverNowMs: 10000 },
      { ...calibration, precisionMs: 2 },
      { ...calibration, serverNowMs: Number.NaN },
    ].map(
      (value) =>
        publicationClock({
          calibration: value,
          anchorMs: 1200,
          sampleRate: 48000,
        }).valid,
    ),
    expected: [false, false, false, false],
  });
});

test('refreshed calibration widens both ends of a frame that began before its sample', () => {
  const clock = publicationClock({
    calibration: { sentAtMs: 1000, receivedAtMs: 1000, serverNowMs: 10000 },
    anchorMs: 1000,
    sampleRate: 48000,
  });
  const refreshed = refreshPublicationClock(clock, {
    sentAtMs: 1009,
    receivedAtMs: 1009,
    serverNowMs: 10009,
  });
  const observed = observeSourceProgress(refreshed, {
    startSample: 0,
    endSample: 480,
    beforeMs: 1010,
    afterMs: 1011,
  });
  assert({
    given: 'a receipt whose calibration is newer than the nominal frame start',
    should: 'bound drift using the furthest full-frame endpoint',
    actual: observed.window,
    expected: { beforeMs: 9999.9991, afterMs: 10011.0009 },
  });
});
