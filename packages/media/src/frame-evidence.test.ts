import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createFrameClock,
  createTrackClocks,
  verifyFrameClockEvidence,
} from './frame-clock';
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

test('serialized original frame mapping is verified without a replacement clock or invented continuity', () => {
  const clock = createFrameClock(calibration);
  const originals = [0, 1, 4, 5, 0].map((sequence, index) => {
    clock.observe({
      sequence,
      beforeMs: 10 + index * 20,
      afterMs: 10.1 + index * 20,
    });
    return clock.evidence()!;
  });
  const original = originals[1]!;
  const mutations = [
    {
      ...originals[0]!,
      observation: { ...originals[0]!.observation, beforeMs: 9 },
    },
    {
      ...original,
      window: { ...original.window, afterMs: original.window.afterMs + 1 },
    },
    { ...original, previous: { ...original.previous!, sequence: 99 } },
    {
      ...original,
      anchor: {
        ...original.anchor,
        calibration: { ...calibration, serverNowMs: 90000 },
      },
    },
    { ...original, observation: { ...original.observation, sequence: 7 } },
    { ...original, unknown: true },
  ];
  assert({
    given:
      'serialized first, contiguous, gap and reset runs, with altered mapping inputs or output',
    should:
      'accept exact original equations and refuse altered mappings without granting continuity between runs',
    actual: [
      originals.map(verifyFrameClockEvidence),
      mutations.map(verifyFrameClockEvidence),
    ],
    expected: [originals.map(() => true), mutations.map(() => false)],
  });
});

test('track clock evidence projects only original scalar observation facts', () => {
  const clocks = createTrackClocks();
  const raw = {
    sequence: 0,
    beforeMs: 10,
    afterMs: 10.1,
    trackId: 'native-track',
    identity: 'private-publisher',
    pcm: new Int16Array(160).fill(-1),
  };
  clocks.observe(raw, calibration);
  const evidence = clocks.evidence(raw.trackId)!;
  assert({
    given:
      'the actual native callback shape, including publisher and PCM outside the clock observation contract',
    should:
      'retain only original scalar clock facts and produce strictly verifiable provenance without copying raw audio/identity into clock metadata',
    actual: {
      observation: Object.keys(evidence.observation).sort(),
      anchor: Object.keys(evidence.anchor.observation).sort(),
      verified: verifyFrameClockEvidence(evidence),
    },
    expected: {
      observation: ['afterMs', 'beforeMs', 'sequence'],
      anchor: ['afterMs', 'beforeMs', 'sequence'],
      verified: true,
    },
  });
});
