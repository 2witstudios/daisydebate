import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createFrameClock } from './frame-clock';
setupRitewayBun();
const calibration = {
  sentAtMs: 0,
  receivedAtMs: 1,
  serverNowMs: 10000,
  precisionMs: 1,
};
test('capture provenance retains the original run calibration through later refreshes', () => {
  const clock = createFrameClock(calibration);
  clock.observe({ sequence: 0, beforeMs: 10, afterMs: 10.1 });
  clock.refresh({
    sentAtMs: 20,
    receivedAtMs: 21,
    serverNowMs: 50000,
    precisionMs: 1,
  });
  const timed = clock.observe({ sequence: 1, beforeMs: 30, afterMs: 30.1 });
  if (!timed) throw new Error('Expected original mapped frame');
  const evidence = clock.evidence();
  assert({
    given:
      'an original anchored run followed by refreshed replacement calibration',
    should:
      'retain original raw sequence, mapping basis and callback instead of reauthorizing the run on new clock data',
    actual: evidence,
    expected: {
      observation: { sequence: 1, beforeMs: 30, afterMs: 30.1 },
      anchor: {
        calibration,
        observation: { sequence: 0, beforeMs: 10, afterMs: 10.1 },
        previous: null,
      },
      previous: { sequence: 0, nominalStartMs: 9999 },
      window: timed,
    },
  });
});
test('a gap and counter reset retain original predecessors without invented continuity', () => {
  const clock = createFrameClock(calibration);
  clock.observe({ sequence: 0, beforeMs: 10, afterMs: 10.1 });
  clock.observe({ sequence: 3, beforeMs: 40, afterMs: 40.1 });
  const gap = clock.evidence();
  clock.observe({ sequence: 1, beforeMs: 60, afterMs: 60.1 });
  const reset = clock.evidence();
  assert({
    given: 'two missing sequence frames and then a native counter reset',
    should:
      'retain each original observation and predecessor with its separate mapping anchor',
    actual: {
      gap: [
        gap?.observation.sequence,
        gap?.anchor.observation.sequence,
        gap?.anchor.previous?.sequence,
        gap?.window.nominalStartMs,
      ],
      reset: [
        reset?.observation.sequence,
        reset?.anchor.observation.sequence,
        reset?.anchor.previous?.sequence,
        reset?.window.nominalStartMs,
      ],
    },
    expected: { gap: [3, 3, 0, 10029], reset: [1, 1, 3, 10049] },
  });
});
test('snapshot consumers cannot mutate the retained mapping and refused callbacks expose no stale proof', () => {
  const clock = createFrameClock(calibration);
  clock.observe({ sequence: 0, beforeMs: 10, afterMs: 10.1 });
  const original = clock.evidence();
  const external = clock.evidence()! as unknown as {
    anchor: { calibration: { serverNowMs: number } };
  };
  external.anchor.calibration.serverNowMs = 999999;
  const retained = clock.evidence();
  clock.observe({ sequence: -1, beforeMs: 20, afterMs: 20.1 });
  assert({
    given: 'a mutated snapshot followed by an invalid callback',
    should:
      'keep original mapping immutable and refuse to attach stale provenance to the rejected frame',
    actual: [retained, clock.evidence()],
    expected: [original, null],
  });
});
