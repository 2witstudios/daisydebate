import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  observeSourceProgress,
  publicationClock,
  reanchorPublicationClock,
  refreshPublicationClock,
} from './publication-clock';

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

test('native receipt rejection preserves predicate order and sub-millisecond limits', () => {
  const receipt = { startSample: 0, endSample: 480, beforeMs: 10, afterMs: 11 };
  const cases = [
    { ...receipt, startSample: 480, beforeMs: Number.NaN },
    { ...receipt, startSample: 480, endSample: 960, beforeMs: 0 },
    { ...receipt, endSample: 479 },
    { ...receipt, beforeMs: 9, afterMs: 8 },
    { ...receipt, afterMs: 9 },
    { ...receipt, afterMs: 110.00000000000001 },
  ];
  assert({
    given: 'native receipts violating one or several cadence predicates',
    should: 'identify the first actual rejection rather than a later snapshot',
    actual: cases.map((value) =>
      reason(observeSourceProgress(initial(), value).clock),
    ),
    expected: [
      'receipt.nonfinite',
      'receipt.noncontiguous',
      'receipt.frame-size',
      'receipt.early',
      'receipt.reversed',
      'receipt.late',
    ],
  });
});

test('refresh rejects its actual envelope or offset guard without reviving an earlier gap', () => {
  const gap = observeSourceProgress(initial(), {
    startSample: 0,
    endSample: 480,
    beforeMs: 1,
    afterMs: 2,
  }).clock;
  const fresh = { sentAtMs: 50, receivedAtMs: 50, serverNowMs: 1050 };
  assert({
    given:
      'a receipt gap, incompatible refreshed offsets, or an excessive refresh RTT',
    should:
      'preserve the earliest gap through refresh and reanchor and name other first rejections',
    actual: [
      reason(refreshPublicationClock(gap, fresh)),
      reason(reanchorPublicationClock(gap, fresh, 50)),
      reason(
        refreshPublicationClock(initial(), { ...fresh, serverNowMs: 2000 }),
      ),
      reason(refreshPublicationClock(initial(), { ...fresh, serverNowMs: 50 })),
      reason(
        refreshPublicationClock(initial(), { ...fresh, receivedAtMs: 151 }),
      ),
    ],
    expected: [
      'receipt.early',
      'receipt.early',
      'refresh.offset-ahead',
      'refresh.offset-behind',
      'calibration.rtt-limit',
    ],
  });
});

test('valid clocks have no rejection and a closed timing boundary remains accepted', () => {
  const accepted = observeSourceProgress(initial(), {
    startSample: 0,
    endSample: 480,
    beforeMs: 10,
    afterMs: 110,
  });
  assert({
    given: 'a native acknowledgement exactly at the permitted lateness bound',
    should:
      'keep the original acceptance and carry no rejection on valid state',
    actual: {
      valid: accepted.clock.valid,
      eligible: accepted.clock.eligibleSamples,
      rejection: reason(accepted.clock),
      hasRejection: 'rejection' in accepted.clock,
    },
    expected: {
      valid: true,
      eligible: 480,
      rejection: null,
      hasRejection: false,
    },
  });
});
