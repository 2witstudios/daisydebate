import { assert, setupRitewayBun, test } from 'riteway/bun';
import { originalBodies } from './audio.test-support';
import { assembleOriginalAudio } from './audio';
setupRitewayBun();
const request = (bodies = originalBodies()) => ({
  roundId: bodies[0]!.roundId,
  evidenceIds: bodies.map((body) => body.evidenceId),
  bodies,
});
test('recovery audio preserves short low-energy originals and their actual ordering', () => {
  const result = assembleOriginalAudio(request());
  const bytes = result.kind === 'assembled' ? result.wav : new Uint8Array();
  assert({
    given:
      'two synthetic contiguous10ms batches with samples below the legacy voiced threshold',
    should:
      'retain both exact frames in one WAV without treating low energy or short duration as absent speech',
    actual:
      result.kind === 'assembled'
        ? [
            result.durationMs,
            bytes.length,
            new DataView(bytes.buffer).getInt16(44, true),
            new DataView(bytes.buffer).getInt16(364, true),
          ]
        : result,
    expected: [20, 684, -1, 1],
  });
});
test('recovery audio refuses missing reordered duplicate and cross-authority originals', () => {
  const bodies = originalBodies(3),
    input = request(bodies);
  const bad = [
    { ...input, bodies: bodies.slice(1) },
    { ...input, bodies: bodies.slice().reverse() },
    {
      ...input,
      evidenceIds: [
        bodies[0]!.evidenceId,
        bodies[0]!.evidenceId,
        bodies[2]!.evidenceId,
      ],
    },
    request([bodies[0]!, bodies[2]!]),
    request([bodies[0]!, { ...bodies[1]!, epoch: 2 }]),
    request([bodies[0]!, { ...bodies[1]!, intervalId: 'j'.repeat(24) }]),
    request([bodies[0]!, { ...bodies[1]!, workerId: 'x'.repeat(24) }]),
    request([
      bodies[0]!,
      { ...bodies[1]!, roundParticipantId: 'q'.repeat(24) },
    ]),
    request([bodies[0]!, { ...bodies[1]!, startOffsetMs: 111 }]),
    { ...input, roundId: 't'.repeat(24) },
    { ...input, evidenceIds: [], bodies: [] },
  ];
  assert({
    given:
      'a changed manifest, absent frame, replacement epoch/grant/worker/seat, invalid offsets or wrong Round',
    should:
      'refuse every assembly without inventing a bridge or accepting a replacement argument',
    actual: bad.map((value) => assembleOriginalAudio(value).kind),
    expected: bad.map(() => 'refused'),
  });
});
test('recovery assembly bounds context units and audio duration independently', () => {
  const maximum = assembleOriginalAudio(request(originalBodies(100, 30)));
  assert({
    given:
      'a real contiguous30s manifest, more than128 small units, or more than30s in fewer units',
    should:
      'encode the exact valid boundary and refuse both oversized contexts',
    actual: [
      maximum.kind === 'assembled'
        ? [maximum.durationMs, maximum.wav.length]
        : maximum,
      assembleOriginalAudio(request(originalBodies(129))).kind,
      assembleOriginalAudio(request(originalBodies(76, 40))).kind,
    ],
    expected: [[30000, 960044], 'refused', 'refused'],
  });
});
test('canonical shape alone cannot authorize invented clock equations or a different original run', () => {
  const bodies = originalBodies();
  const altered = bodies.map((body) => ({
    ...body,
    frames: body.frames.map((frame) => ({
      ...frame,
      clock: {
        ...frame.clock,
        anchor: {
          ...frame.clock.anchor,
          calibration: {
            ...frame.clock.anchor.calibration,
            serverNowMs: frame.clock.anchor.calibration.serverNowMs + 1,
          },
        },
      },
    })),
  }));
  const discontinuous = [
    bodies[0]!,
    {
      ...bodies[1]!,
      frames: bodies[1]!.frames.map((frame) => ({
        ...frame,
        clock: { ...frame.clock, previous: null },
      })),
    },
  ];
  assert({
    given:
      'coherent JSON shapes whose original mapping equations or previous observation are false',
    should:
      'refuse encoding rather than manufacture valid timing from stored fields',
    actual: [
      assembleOriginalAudio(request(altered)).kind,
      assembleOriginalAudio(request(discontinuous)).kind,
    ],
    expected: ['refused', 'refused'],
  });
});
