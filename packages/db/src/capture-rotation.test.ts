import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sealState } from './capture-rules';
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
