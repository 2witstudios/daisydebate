import { assert, setupRitewayBun, test } from 'riteway/bun';
import { proofMatches } from './media-reconcile-contracts';

setupRitewayBun();

const fence = { sessionId: 'session', owner: 'worker', epoch: 2 };
const proof = { ...fence, settledMutationCount: 3 };

test('an absence proof counts only for its own fence and unchanged mutation horizon', () => {
  assert({
    given:
      'a matching proof, no proof, and proofs from another session, owner, epoch or horizon',
    should: 'match only the exact proof',
    actual: [
      proofMatches(proof, fence, 3),
      proofMatches(null, fence, 3),
      proofMatches({ ...proof, sessionId: 'other' }, fence, 3),
      proofMatches({ ...proof, owner: 'other' }, fence, 3),
      proofMatches({ ...proof, epoch: 1 }, fence, 3),
      proofMatches(proof, fence, 4),
    ],
    expected: [true, false, false, false, false, false],
  });
});
