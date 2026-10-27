import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  captureAdmissionClosed,
  clipDigests,
  requireCapturedWindow,
  requireLiveCaptureLease,
  requireObservationWindow,
  sealAction,
  sealState,
} from './capture-rules';

setupRitewayBun();

const t0 = Date.parse('2026-10-22T12:00:00.000Z');
const iso = (offsetMs: number) => new Date(t0 + offsetMs).toISOString();
const segment = {
  startedAt: new Date(t0),
  endedAt: new Date(t0 + 10_000),
  durationMs: 60_000,
};
const now = new Date(t0 + 20_000);
const grant = [{ start: t0, end: t0 + 10_000 }];

test('a clip bracket must contain its nominal position inside one grant', async () => {
  const clip = {
    before: iso(99),
    after: iso(201),
    startOffsetMs: 100,
    durationMs: 100,
  };
  assert({
    given: 'a bracket around the nominal clip inside the speaking grant',
    should: 'admit the clip',
    actual: [
      requireCapturedWindow(clip, segment, now, grant),
      requireCapturedWindow(clip, { ...segment, endedAt: null }, now, [
        { start: t0, end: null },
      ]),
    ],
    expected: [undefined, undefined],
  });
  for (const [label, candidate, history, at] of [
    ['an inverted bracket', { ...clip, after: iso(99) }, grant, now],
    ['a future bracket', clip, grant, new Date(t0 + 200)],
    [
      'a bracket starting after the nominal start',
      { ...clip, before: iso(101) },
      grant,
      now,
    ],
    [
      'a bracket ending before the nominal end',
      { ...clip, after: iso(199) },
      grant,
      now,
    ],
    ['no covering grant', clip, [{ start: t0 + 150, end: t0 + 900 }], now],
    [
      'a bracket at the grant end',
      { ...clip, after: iso(10_000) },
      [{ start: t0, end: t0 + 10_000 }],
      now,
    ],
    [
      'a bracket past the segment end',
      { ...clip, after: iso(10_001) },
      [{ start: t0, end: null }],
      now,
    ],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse the clip window',
      actual: () => requireCapturedWindow(candidate, segment, at, history),
      code: 'CONFLICT',
    });
});

test('an observation lies within one grant, the segment and the past', async () => {
  assert({
    given: 'an observation covering the whole closed grant',
    should: 'return its millisecond bounds',
    actual: requireObservationWindow(
      { observedFrom: iso(0), observedUntil: iso(10_000) },
      segment,
      now,
      grant,
    ),
    expected: { from: t0, until: t0 + 10_000 },
  });
  for (const [label, from, until, at] of [
    ['an empty observation', 500, 500, now],
    ['a future observation', 0, 5_000, new Date(t0 + 4_000)],
    ['an observation past the segment', 0, 10_001, now],
    ['an observation outside every grant', -1, 5_000, now],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse it as outside capture authority',
      actual: () =>
        requireObservationWindow(
          { observedFrom: iso(from), observedUntil: iso(until) },
          { ...segment, endedAt: new Date(t0 + 10_000) },
          at,
          [{ start: t0, end: null }],
        ),
      code: 'CONFLICT',
    });
});

test('the clip key names its position and the body digest every captured field', () => {
  const clip = {
    roundId: 'round',
    segmentId: 'segment',
    roundParticipantId: 'seat',
    trackId: 'track',
    startOffsetMs: 100,
    durationMs: 100,
    text: 'Captured speech',
    before: iso(99),
    after: iso(201),
  };
  const base = clipDigests(clip);
  assert({
    given: 'the same position with other text, and another position',
    should: 'keep the clip key and change the body, or change both',
    actual: {
      sameKey: clipDigests({ ...clip, text: 'Other' }).clipKey === base.clipKey,
      sameBody:
        clipDigests({ ...clip, text: 'Other' }).bodyDigest === base.bodyDigest,
      movedKey:
        clipDigests({ ...clip, startOffsetMs: 300 }).clipKey === base.clipKey,
      hex: [base.clipKey, base.bodyDigest].every((d) =>
        /^[0-9a-f]{64}$/.test(d),
      ),
    },
    expected: { sameKey: true, sameBody: false, movedKey: false, hex: true },
  });
});

test('seals retry identically, never undercount and wait for a closed timeline', async () => {
  const open = { state: 'open', chunkCount: 2, sealedChunkCount: null };
  const closed = { segmentEnded: true, required: grant };
  assert({
    given:
      'an identical retry of a sealed stream and an open stream ready to seal',
    should: 'retry and seal',
    actual: [
      sealAction(
        { state: 'complete', chunkCount: 2, sealedChunkCount: 2 },
        2,
        closed,
      ),
      sealAction(open, 2, closed),
      sealAction(open, 3, closed),
    ],
    expected: ['retry', 'seal', 'seal'],
  });
  for (const [label, stream, expected, timeline] of [
    [
      'a changed seal retry',
      { state: 'partial', chunkCount: 2, sealedChunkCount: 2 },
      3,
      closed,
    ],
    ['a seal below the stored chunks', open, 1, closed],
    ['an unended segment', open, 2, { segmentEnded: false, required: grant }],
    [
      'an open speaking grant',
      open,
      2,
      { segmentEnded: true, required: [{ start: t0, end: null }] },
    ],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse the seal',
      actual: () => sealAction(stream, expected, timeline),
      code: 'CONFLICT',
    });
});

test('a seal is complete only with this epoch’s full evidence', () => {
  const evidence = {
    epoch: 2,
    observations: [
      { start: new Date(t0), end: new Date(t0 + 10_000), epoch: 2 },
    ],
    chunks: { count: 2, otherEpochChunks: 0 },
    storedChunks: 2,
    expectedChunks: 2,
    authority: grant,
    tolerance: { openMs: 2_000, closeMs: 0 },
  };
  const joined = (from: number, until = t0 + 10_000) => [
    { start: new Date(t0 + from), end: new Date(until), epoch: 2 },
  ];
  assert({
    given:
      'full coverage, each missing piece of evidence in turn, then a first frame at and past the join tolerance and a gap after a late join',
    should:
      'seal complete only for the full evidence from the first frame within the tolerance (DEC-218)',
    actual: [
      sealState(evidence),
      sealState({ ...evidence, chunks: undefined }),
      sealState({ ...evidence, chunks: { count: 2, otherEpochChunks: 1 } }),
      sealState({
        ...evidence,
        observations: [{ ...evidence.observations[0]!, epoch: 1 }],
      }),
      sealState({ ...evidence, storedChunks: 3 }),
      sealState({
        ...evidence,
        observations: [
          { ...evidence.observations[0]!, end: new Date(t0 + 9_000) },
        ],
      }),
      sealState({ ...evidence, observations: joined(2_000) }),
      sealState({ ...evidence, observations: joined(2_001) }),
      sealState({
        ...evidence,
        observations: [...joined(1_000, t0 + 5_000), ...joined(5_010)],
      }),
    ],
    expected: [
      'complete',
      'partial',
      'partial',
      'partial',
      'partial',
      'partial',
      'complete',
      'partial',
      'partial',
    ],
  });
});

test('capture admission closes at freeze, cutoff or a terminal Round', async () => {
  const at = iso(0);
  assert({
    given: 'open and closing admission facts',
    should:
      'close only for freeze, a missing Round, a reached cutoff or a terminal Round without one',
    actual: [
      captureAdmissionClosed({
        frozen: false,
        roundStatus: 'active',
        now: at,
        cutoff: iso(1),
      }),
      captureAdmissionClosed({
        frozen: false,
        roundStatus: 'active',
        now: at,
        cutoff: null,
      }),
      captureAdmissionClosed({
        frozen: true,
        roundStatus: 'active',
        now: at,
        cutoff: iso(1),
      }),
      captureAdmissionClosed({
        frozen: false,
        roundStatus: undefined,
        now: at,
        cutoff: iso(1),
      }),
      captureAdmissionClosed({
        frozen: false,
        roundStatus: 'active',
        now: at,
        cutoff: at,
      }),
      captureAdmissionClosed({
        frozen: false,
        roundStatus: 'completed',
        now: at,
        cutoff: null,
      }),
      captureAdmissionClosed({
        frozen: false,
        roundStatus: 'completed',
        now: at,
        cutoff: iso(1),
      }),
    ],
    expected: [false, false, true, true, true, true, false],
  });
  await assertRejects({
    given: 'a capture lease expiring exactly now',
    should: 'refuse the worker',
    actual: () => requireLiveCaptureLease(new Date(t0), new Date(t0)),
    code: 'CONFLICT',
  });
});
