import { assert, setupRitewayBun, test } from 'riteway/bun';
import { foreignKeyNameValid } from '../../integration/baseline-naming.test-support';
setupRitewayBun();
test('privacy tombstone reference vocabulary stays scoped to the exact approved relation', () => {
  assert({
    given: 'the ADR0036 subject FK and lookalike mismatched relations',
    should:
      'allow exactly its users binding while preserving ordinary FK suffix guards',
    actual: [
      { col: 'privacy_jobs.subject_ref', target: 'users' },
      { col: 'privacy_jobs.subject_ref', target: 'actors' },
      { col: 'other.subject_ref', target: 'users' },
      { col: 'privacy_jobs.other_ref', target: 'users' },
      { col: 'other.owner_actor_id', target: 'actors' },
    ].map(foreignKeyNameValid),
    expected: [true, false, false, false, true],
  });
});
