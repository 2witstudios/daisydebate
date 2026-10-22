import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  publicationClock,
  observeSourceProgress,
  refreshPublicationClock,
} from './publication-clock';
setupRitewayBun();
test('review: drift uncertainty includes timestamp sampled at request-send edge', () => {
  const calibration = {
    sentAtMs: 0,
    receivedAtMs: 100,
    serverNowMs: 10000,
    precisionMs: 1,
  };
  const clock = publicationClock({
    calibration,
    anchorMs: 100,
    sampleRate: 48000,
  });
  const afterMs = 110.99;
  const { window } = observeSourceProgress(clock, {
    startSample: 0,
    endSample: 480,
    beforeMs: 110,
    afterMs,
  });
  // A permitted server clock: timestamp sampled at send, floor precision1ms,
  // 100ppm faster than local monotonic time. No discontinuity or excessive RTT.
  const actualServerAck = 10000.9999 + afterMs * 1.0001;
  assert({
    given:
      'legal100ms RTT, timestamp at send edge,1ms quantization and100ppm drift',
    should:
      'conservatively contain the real acknowledgement after outward ISO rounding',
    actual: {
      valid: clock.valid,
      contains: Math.ceil(window!.afterMs) >= actualServerAck,
      roundedUpper: Math.ceil(window!.afterMs),
      requiredUpper: Math.ceil(actualServerAck),
    },
    expected: {
      valid: true,
      contains: true,
      roundedUpper: 10113,
      requiredUpper: 10113,
    },
  });
});

test('refresh intersection includes drift since the previous calibration send edge', () => {
  const clock = publicationClock({
    calibration: {
      sentAtMs: 0,
      receivedAtMs: 100,
      serverNowMs: 10000,
      precisionMs: 1,
    },
    anchorMs: 100,
    sampleRate: 48000,
  });
  const next = refreshPublicationClock(clock, {
    sentAtMs: 1100,
    receivedAtMs: 1100,
    serverNowMs: 11101.105,
  });
  assert({
    given: 'a legal refreshed offset inside the send-edge drift bound',
    should: 'retain the continuous anchor',
    actual: next.valid,
    expected: true,
  });
});

test('both frame endpoints contain permitted send, middle and receive clock samples', () => {
  const cases = [0, 50, 100].flatMap((sampleAt) =>
    [-0.0001, 0, 0.0001].flatMap((rateError) =>
      [0, 0.9999].map((quantization) => ({
        sampleAt,
        rateError,
        quantization,
      })),
    ),
  );
  const clock = publicationClock({
    calibration: {
      sentAtMs: 0,
      receivedAtMs: 100,
      serverNowMs: 10000,
      precisionMs: 1,
    },
    anchorMs: 100,
    sampleRate: 48000,
  });
  const { window } = observeSourceProgress(clock, {
    startSample: 0,
    endSample: 480,
    beforeMs: 110,
    afterMs: 110.99,
  });
  assert({
    given:
      'sample location, quantization and drift extrema inside the calibration contract',
    should:
      'contain the full real source period and acknowledgement without ISO rounding assistance',
    actual: cases.every(({ sampleAt, rateError, quantization }) => {
      const serverAt = (time: number) =>
        10000 + quantization + (time - sampleAt) * (1 + rateError);
      return (
        window!.beforeMs <= serverAt(100) && window!.afterMs >= serverAt(110.99)
      );
    }),
    expected: true,
  });
});
