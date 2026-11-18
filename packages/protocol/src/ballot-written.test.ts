import { assert, setupRitewayBun, test } from 'riteway/bun';
import { daisyWinnerBallot, ballotDefinitionSchema } from './ballot-definition';
import {
  ballotSchemaFor,
  ballotRecordSchema,
  ballotCompetitionSchemaFor,
} from './ballot-schema';
setupRitewayBun();
test('off written parts are absent and reject collection in the canonical ballot contract', () => {
  const definition = {
    ...daisyWinnerBallot,
    key: 'written-off',
    revision: 1,
    points: null,
    written: { reason: null, feedback: null },
  };
  const subjects = {
    sides: ['affirmative', 'negative'],
    speakers: [],
    segments: [],
  };
  const ballot = { rubricVersion: 'written-off@1', winner: 'affirmative' };
  const schema = ballotSchemaFor(definition, subjects);
  assert({
    given: 'a canonical definition with reason and feedback off',
    should:
      'accept competition alone, retain that wire frame, and refuse any off/private-note field',
    actual: [
      ballotDefinitionSchema.safeParse(definition).success,
      schema.safeParse(ballot).success,
      ballotRecordSchema.safeParse(ballot).success,
      ballotCompetitionSchemaFor(definition, subjects).safeParse(ballot)
        .success,
      ...[
        { reason: 'Attempted text' },
        { feedback: {} },
        { feedback: { affirmative: 'Attempted text' } },
        { privateNote: 'Not enabled' },
      ].map((extra) => schema.safeParse({ ...ballot, ...extra }).success),
    ],
    expected: [true, true, true, true, false, false, false, false],
  });
});
