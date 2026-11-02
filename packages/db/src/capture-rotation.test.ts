import { assert, setupRitewayBun, test } from 'riteway/bun';
import { partialSealCause, sealState } from './capture-rules';
setupRitewayBun();

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

test('a partial seal says why, as a fact (ISSUE-952)', () => {
  const observed = new Date(1_000);
  const seal = {
    interrupted: false,
    framesLost: false,
    epoch: 1,
    observations: [{ start: observed, end: new Date(2_000), epoch: 1 }],
    chunks: { count: 1, otherEpochChunks: 0 },
    storedChunks: 1,
    expectedChunks: 1,
    authority: [{ start: 1_000, end: 2_000 }],
    tolerance: { openMs: 0, closeMs: 0 },
  };
  const cases = [
    ['nothing wrong', seal, null],
    ['an interrupted session', { ...seal, interrupted: true }, 'interrupted'],
    ['lost frames', { ...seal, framesLost: true }, 'frames_lost'],
    [
      'another worker’s chunks',
      { ...seal, chunks: { count: 1, otherEpochChunks: 1 } },
      'other_epoch',
    ],
    [
      'a stored count that disagrees',
      { ...seal, storedChunks: 2 },
      'stored_chunks',
    ],
    [
      'a hole in the capture',
      { ...seal, authority: [{ start: 1_000, end: 9_000 }] },
      'coverage',
    ],
  ] as const;
  for (const [given, evidence, expected] of cases)
    assert({
      given,
      should: `say ${expected}`,
      actual: partialSealCause(evidence),
      expected,
    });
});
