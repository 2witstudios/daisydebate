import { assert, setupRitewayBun, test } from 'riteway/bun';
import { parseOutcome } from '../parse-outcome.test-support';
import {
  fixtureCommandCatalogue,
  fixtureCommandEnvelopeSchema,
  fixtureCommandRefusals,
  fixtureCommandSchema,
} from './fixture-command';

setupRitewayBun();

const id = (letter: string) => letter.repeat(24);
const fixtureId = id('f');

const valid = {
  'assign-judge': {
    type: 'assign-judge',
    fixtureId,
    judgeId: id('j'),
    chair: true,
    overrides: [
      { key: 'judging.strike', reason: 'Only judge left in the slot' },
    ],
  },
  'replace-judge': {
    type: 'replace-judge',
    fixtureId,
    outJudgeId: id('j'),
    inJudgeId: id('k'),
    overrides: [],
  },
  'unassign-judge': { type: 'unassign-judge', fixtureId, judgeId: id('j') },
  'restart-fixture': {
    type: 'restart-fixture',
    fixtureId,
    reason: 'Audio failed for both sides',
  },
  'record-forfeit': {
    type: 'record-forfeit',
    fixtureId,
    entryId: id('e'),
    reason: 'No show',
  },
} as const;

test('fixture commands', () => {
  for (const [type, command] of Object.entries(valid)) {
    assert({
      given: `a valid ${type}`,
      should: 'parse to itself',
      actual: parseOutcome(fixtureCommandSchema, command),
      expected: { data: command },
    });
  }

  const envelope = {
    version: 1,
    commandId: id('c'),
    expected: { fixture: 3 },
    command: valid['assign-judge'],
  };
  assert({
    given: 'an envelope carrying an assign-judge',
    should: 'parse to itself',
    actual: parseOutcome(fixtureCommandEnvelopeSchema, envelope),
    expected: { data: envelope },
  });

  assert({
    given: 'an assign-judge with a judge id that is not a cuid2',
    should: 'reject the judge id',
    actual: parseOutcome(fixtureCommandSchema, {
      ...valid['assign-judge'],
      judgeId: 'judge-1',
    }).issues,
    expected: ['judgeId'],
  });

  assert({
    given: 'an assign-judge without its chair flag',
    should: 'reject it',
    actual: parseOutcome(fixtureCommandSchema, {
      type: 'assign-judge',
      fixtureId,
      judgeId: id('j'),
      overrides: [],
    }).issues,
    expected: ['chair'],
  });

  assert({
    given: 'an override of a key that is not a judging rule',
    should: 'reject the key',
    actual: parseOutcome(fixtureCommandSchema, {
      ...valid['assign-judge'],
      overrides: [{ key: 'pairing.rematch', reason: 'x' }],
    }).issues,
    expected: ['overrides.0.key'],
  });

  assert({
    given: 'two overrides of one rule',
    should: 'reject the overrides',
    actual: parseOutcome(fixtureCommandSchema, {
      ...valid['assign-judge'],
      overrides: [
        { key: 'judging.strike', reason: 'a' },
        { key: 'judging.strike', reason: 'b' },
      ],
    }).issues,
    expected: ['overrides'],
  });

  assert({
    given: 'a judge replaced by themselves',
    should: 'reject the incoming judge',
    actual: parseOutcome(fixtureCommandSchema, {
      ...valid['replace-judge'],
      inJudgeId: id('j'),
    }).issues,
    expected: ['inJudgeId'],
  });

  assert({
    given: 'a restart whose reason is over the limit',
    should: 'reject the reason',
    actual: parseOutcome(fixtureCommandSchema, {
      ...valid['restart-fixture'],
      reason: 'x'.repeat(2001),
    }).issues,
    expected: ['reason'],
  });

  assert({
    given: 'a forfeit without an entry',
    should: 'reject it',
    actual: parseOutcome(fixtureCommandSchema, {
      type: 'record-forfeit',
      fixtureId,
      reason: 'No show',
    }).issues,
    expected: ['entryId'],
  });

  assert({
    given: 'an unassign-judge with an unknown key',
    should: 'reject it (strict)',
    actual: parseOutcome(fixtureCommandSchema, {
      ...valid['unassign-judge'],
      drawVersion: 2,
    }).issues,
    expected: ['(root)'],
  });

  assert({
    given: 'an unknown command type',
    should: 'reject it',
    actual: parseOutcome(fixtureCommandSchema, {
      type: 'reschedule-fixture',
      fixtureId,
    }).issues,
    expected: ['type'],
  });
});

test('fixture command catalogue', () => {
  assert({
    given: 'the catalogue',
    should: 'define every command of the union',
    actual: Object.keys(fixtureCommandCatalogue).sort(),
    expected: Object.keys(valid).sort(),
  });

  assert({
    given: 'every definition',
    should: 'name only refusals of the group list, a gate and a history entry',
    actual: Object.values(fixtureCommandCatalogue).every(
      (definition) =>
        definition.gate.length > 0 &&
        definition.history === 'entry' &&
        definition.refusals.every((refusal) =>
          (fixtureCommandRefusals as readonly string[]).includes(refusal),
        ),
    ),
    expected: true,
  });

  assert({
    given: 'every officiating command',
    should: 'check the fixture version and no draw version',
    actual: Object.values(fixtureCommandCatalogue).map((definition) => [
      ...definition.versions,
    ]),
    expected: Object.keys(valid).map(() => ['fixture']),
  });

  assert({
    given: 'the group refusal list',
    should: 'have every refusal given by some command',
    actual: fixtureCommandRefusals.filter(
      (refusal) =>
        !Object.values(fixtureCommandCatalogue).some((definition) =>
          (definition.refusals as readonly string[]).includes(refusal),
        ),
    ),
    expected: [],
  });
});

test('replace-judge refuses as both unassign and assign do', () => {
  const refusals = new Set<string>(
    fixtureCommandCatalogue['replace-judge'].refusals,
  );
  const both = [
    ...fixtureCommandCatalogue['assign-judge'].refusals,
    ...fixtureCommandCatalogue['unassign-judge'].refusals,
  ];
  assert({
    given: 'the replace-judge refusals',
    should: 'include each refusal of assign and unassign',
    actual: both.every((refusal) => refusals.has(refusal)),
    expected: true,
  });
});
