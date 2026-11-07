import { assert, setupRitewayBun, test } from 'riteway/bun';
import { canStartTranscription } from './start-window';
setupRitewayBun();
const at = '2026-11-07T12:00:00.000Z';
test('call start uses a pre-request anchor and subtracts serialized clock precision', () => {
  const grant = { admittedAt: at, startBefore: '2026-11-07T12:00:00.010Z' };
  assert({
    given:
      'a10ms serialized lifetime and a delayed admission response, including the .0009→.000 near-boundary case',
    should:
      'refuse at the conservative9ms boundary and never renew permission on response arrival',
    actual: [8.999, 9, 10, 100].map((now) =>
      canStartTranscription({
        beforeAdmissionMs: 100,
        nowMs: 100 + now,
        grant,
      }),
    ),
    expected: [true, false, false, false],
  });
  const near = { admittedAt: at, startBefore: '2026-11-07T12:00:00.001Z' };
  assert({
    given:
      'only1ms serialized lifetime which can overstate actual remaining time by almost1ms',
    should:
      'refuse even an immediate dispatch rather than rely on network delay to cover quantization',
    actual: canStartTranscription({
      beforeAdmissionMs: 100,
      nowMs: 100,
      grant: near,
    }),
    expected: false,
  });
});
test('invalid or regressed clocks never yield transcription permission', () => {
  const grant = { admittedAt: at, startBefore: '2026-11-07T12:00:00.010Z' };
  assert({
    given:
      'regressed/nonfinite local clocks or malformed/reversed server times',
    should: 'fail closed',
    actual: [
      canStartTranscription({ beforeAdmissionMs: 100, nowMs: 99, grant }),
      canStartTranscription({ beforeAdmissionMs: NaN, nowMs: 100, grant }),
      canStartTranscription({
        beforeAdmissionMs: 100,
        nowMs: 100,
        grant: { ...grant, startBefore: 'invalid' },
      }),
      canStartTranscription({
        beforeAdmissionMs: 100,
        nowMs: 100,
        grant: { ...grant, startBefore: '2026-11-07T11:59:59.000Z' },
      }),
    ],
    expected: [false, false, false, false],
  });
});
