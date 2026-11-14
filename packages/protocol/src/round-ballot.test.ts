import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ballotCategories } from './ballot';
import { daisyWinnerBallot } from './ballot-definition';
import { ballotSchemaFor } from './ballot-schema';
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
    rubricVersion: 'speaker-10@2',
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
    { ...envelope, ballot: { ...envelope.ballot, rubricVersion: 'v2' } },
  ];
  assert({
    given:
      'valid rubric and invalid authority, revision, lifecycle and rubric inputs',
    should: 'accept only the strict versioned ballot envelope',
    actual: cases.map(
      (input) => roundBallotEnvelopeSchema.safeParse(input).success,
    ),
    expected: [true, false, false, false, false, false, false, false],
  });
});
test("the Round's own schema judges the ballot an envelope carries", () => {
  const schema = ballotSchemaFor(daisyWinnerBallot, {
    sides: ['affirmative', 'negative'],
    speakers: [],
    segments: [],
  });
  assert({
    given: 'the valid ballot, then an unknown winner and missing scores',
    should: 'accept the first and refuse the others',
    actual: [
      envelope.ballot,
      { ...envelope.ballot, winner: 'draw' },
      { ...envelope.ballot, scores: {} },
    ].map((ballot) => schema.safeParse(ballot).success),
    expected: [true, false, false],
  });
});
