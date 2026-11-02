import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createCaptureRule, decideStreamCapture } from './capture-verdict';

setupRitewayBun();

const sealState = ({
  observations,
  ...facts
}: Omit<Parameters<typeof decideStreamCapture>[0], 'observations'> & {
  readonly observations: readonly {
    readonly start: Date;
    readonly end: Date;
    readonly epoch: number;
  }[];
}) =>
  decideStreamCapture({
    ...facts,
    observations: observations.map((row) => ({
      start: row.start.getTime(),
      end: row.end.getTime(),
      epoch: row.epoch,
    })),
  }).state;
const t0 = Date.parse('2026-10-22T12:00:00.000Z');
const grant = [{ start: t0, end: t0 + 10_000 }];

test('a partial stream always says why, even with no gaps', () => {
  const whole = {
    epoch: 2,
    observations: [{ start: 1000, end: 2000, epoch: 2 }],
    chunks: { count: 1, otherEpochChunks: 0 },
    storedChunks: 1,
    expectedChunks: 1,
    authority: [{ start: 1000, end: 2000 }],
    tolerance: { openMs: 0, closeMs: 0 },
  };
  assert({
    given: 'continuous observations and a worker that lost frames',
    should: 'be partial for frames lost, with no gap to show',
    actual: decideStreamCapture({ ...whole, framesLost: true }),
    expected: { state: 'partial', reasons: ['frames-lost'], gaps: [] },
  });
  assert({
    given: 'an earlier worker\u2019s chunks and an interrupted session',
    should: 'give every reason',
    actual: decideStreamCapture({
      ...whole,
      interrupted: true,
      chunks: { count: 1, otherEpochChunks: 1 },
    }),
    expected: {
      state: 'partial',
      reasons: ['session-interrupted', 'other-worker-evidence'],
      gaps: [],
    },
  });
  assert({
    given: 'nothing required of the stream and no unused grant',
    should: 'say so rather than be partial with no reason',
    actual: decideStreamCapture({ ...whole, authority: [] }),
    expected: { state: 'partial', reasons: ['nothing-required'], gaps: [] },
  });
  assert({
    given: 'an uncaptured stretch',
    should: 'return the reason and the gap from the same decision',
    actual: decideStreamCapture({
      ...whole,
      observations: [{ start: 1000, end: 1500, epoch: 2 }],
    }),
    expected: {
      state: 'partial',
      reasons: ['coverage-gap'],
      gaps: [{ start: 1500, end: 2000 }],
    },
  });
  assert({
    given: 'whole evidence',
    should: 'be complete with no reasons',
    actual: decideStreamCapture(whole),
    expected: { state: 'complete', gaps: [] },
  });
});

test('room deletion remains an interruption even when the new epoch covers join tolerance', () => {
  const evidence = {
    epoch: 3,
    observations: [{ start: new Date(100), end: new Date(1000), epoch: 3 }],
    chunks: { count: 0, otherEpochChunks: 0 },
    storedChunks: 0,
    expectedChunks: 0,
    authority: [{ start: 0, end: 1000 }],
    tolerance: { openMs: 4000, closeMs: 1000 },
  };
  assert({
    given:
      'rotation before the first persisted chunk and new-room audio within join tolerance',
    should: 'retain partial truth without inventing an utterance',
    actual: [
      sealState({ ...evidence, interrupted: true }),
      sealState(evidence),
    ],
    expected: ['partial', 'complete'],
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

test('a bot grant it did not use seals complete only with no evidence of speech (ISSUE-965)', () => {
  const silent = {
    epoch: 1,
    observations: [],
    chunks: { count: 0, otherEpochChunks: 0 },
    storedChunks: 0,
    expectedChunks: 0,
    authority: [],
    tolerance: { openMs: 0, closeMs: 0 },
    grantUnused: true,
  };
  const heard = {
    start: new Date(1000),
    end: new Date(1100),
    epoch: 1,
  };
  assert({
    given:
      'an unused grant with no evidence, a grant that is owed, then interruption, lost frames, an observation, a stored chunk and an expected chunk',
    should: 'seal only the first complete',
    actual: [
      sealState(silent),
      sealState({ ...silent, grantUnused: false }),
      sealState({ ...silent, interrupted: true }),
      sealState({ ...silent, framesLost: true }),
      sealState({ ...silent, observations: [heard] }),
      sealState({ ...silent, storedChunks: 1 }),
      sealState({ ...silent, expectedChunks: 1 }),
    ],
    expected: [
      'complete',
      'partial',
      'partial',
      'partial',
      'partial',
      'partial',
      'partial',
    ],
  });
});

test('what a stream must cover depends on who holds the seat (DEC-218, DEC-219)', () => {
  const rule = createCaptureRule({ joinMs: 4000, relayMs: 1000 });
  const grants = [{ start: 1000, end: 6000 }];
  const windows = [{ start: 1880, end: 4790 }];
  assert({
    given: 'a human seat',
    should:
      'require its grants, opening by join tolerance and closing by relay',
    actual: rule.coverage('human', grants, windows),
    expected: { authority: grants, tolerance: { openMs: 4000, closeMs: 1000 } },
  });
  assert({
    given: 'a bot seat',
    should:
      'require only its credited windows, with relay edges and a terminal zone',
    actual: rule.coverage('bot', grants, windows),
    expected: {
      authority: windows,
      tolerance: { openMs: 1000, closeMs: 1000, terminalCloseMs: 1000 },
    },
  });
});
