import { assert, setupRitewayBun, test } from 'riteway/bun';
import { calibrationOffsets, publicationClock } from './publication-clock';

setupRitewayBun();
const initial = () =>
  publicationClock({
    calibration: {
      sentAtMs: 0,
      receivedAtMs: 0,
      serverNowMs: 1000,
      precisionMs: 1,
    },
    anchorMs: 0,
    sampleRate: 48000,
  });
const reason = (clock: ReturnType<typeof publicationClock>) =>
  clock.valid ? null : clock.rejection;

test('calibration rejection identifies the first failed contract predicate', () => {
  const cases = [
    { sentAtMs: Number.NaN, receivedAtMs: -1, serverNowMs: 0 },
    { sentAtMs: 2, receivedAtMs: 1, serverNowMs: 0 },
    { sentAtMs: 0, receivedAtMs: 100.00000000000001, serverNowMs: 0 },
    { sentAtMs: 0, receivedAtMs: 0, serverNowMs: 0, precisionMs: -1 },
    { sentAtMs: 0, receivedAtMs: 0, serverNowMs: 0, precisionMs: 1.000001 },
  ];
  assert({
    given:
      'invalid calibrations, including simultaneous nonfinite and reversed fields',
    should: 'retain the actual first rejection without rounding a boundary',
    actual: cases.map((calibration) =>
      reason(
        publicationClock({ calibration, anchorMs: 101, sampleRate: 48000 }),
      ),
    ),
    expected: [
      'calibration.nonfinite',
      'calibration.rtt-order',
      'calibration.rtt-limit',
      'calibration.precision-order',
      'calibration.precision-limit',
    ],
  });
});

const calibration = { sentAtMs: 1000, receivedAtMs: 1020, serverNowMs: 10000 };

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

test('calibration offsets bound both endpoints by the request bracket and drift', () => {
  assert({
    given: 'a 20 ms request bracket and a span inside it',
    should: 'bound the server offset by the whole bracket, widened by drift',
    actual: calibrationOffsets(calibration, 1000, 1020),
    expected: { lower: 8980 - 0.002, upper: 9000 + 0.002 },
  });
});
