import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ballotCategories } from './ballot';
import { roundBallotEnvelopeSchema } from './round-ballot';
setupRitewayBun();
const scores = Object.fromEntries(
  ballotCategories.map((category) => [category, 3]),
);
const envelope = {
  version: 1,
  commandId: 'c'.repeat(24),
  expectedVersion: 4,
  judgeParticipantId: 'j'.repeat(24),
  freezeRevision: 1,
  ballot: {
    rubricVersion: 'speaker-10@1',
    winner: 'affirmative',
    scores: { affirmative: scores, negative: scores },
    reason: 'The affirmative established the decisive comparison.',
    feedback: {},
  },
};
test('shared ballots require the frozen rubric input and reject authority or result claims', () => {
  const cases = [
    envelope,
    { ...envelope, outcome: 'negative' },
    { ...envelope, actorId: 'a'.repeat(24) },
    { ...envelope, serviceId: 'worker' },
    { ...envelope, freezeRevision: 0 },
    { ...envelope, expectedVersion: 0 },
    { ...envelope, version: 2 },
    { ...envelope, ballot: { ...envelope.ballot, winner: 'draw' } },
    { ...envelope, ballot: { ...envelope.ballot, scores: {} } },
  ];
  assert({
    given:
      'valid rubric and invalid authority, revision, lifecycle and score inputs',
    should: 'accept only the strict versioned ballot envelope',
    actual: cases.map(
      (input) => roundBallotEnvelopeSchema.safeParse(input).success,
    ),
    expected: [true, false, false, false, false, false, false, false, false],
  });
});
