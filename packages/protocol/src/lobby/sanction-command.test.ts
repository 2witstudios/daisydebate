import { assert, setupRitewayBun, test } from 'riteway/bun';
import { parseOutcome } from '../parse-outcome.test-support';
import {
  sanctionCommandCatalogue,
  sanctionCommandEnvelopeSchema,
  sanctionCommandRefusals,
  sanctionCommandSchema,
} from './sanction-command';

setupRitewayBun();

const id = (letter: string) => letter.repeat(24);

const valid = {
  'request-sanction': {
    type: 'request-sanction',
    leagueId: id('l'),
    eventId: id('v'),
    templateId: id('t'),
    seasonId: id('s'),
  },
  'approve-sanction': { type: 'approve-sanction', sanctionId: id('n') },
  'decline-sanction': { type: 'decline-sanction', sanctionId: id('n') },
  'withdraw-sanction': {
    type: 'withdraw-sanction',
    sanctionId: id('n'),
    reason: 'The event moved out of the season',
  },
} as const;

test('sanction commands', () => {
  for (const [type, command] of Object.entries(valid))
    assert({
      given: `a valid ${type}`,
      should: 'parse to itself',
      actual: parseOutcome(sanctionCommandSchema, command),
      expected: { data: command },
    });

  const envelope = {
    version: 1,
    commandId: id('c'),
    expected: { sanction: 2 },
    command: valid['approve-sanction'],
  };
  assert({
    given: 'an envelope carrying an approval',
    should: 'parse to itself',
    actual: parseOutcome(sanctionCommandEnvelopeSchema, envelope),
    expected: { data: envelope },
  });

  assert({
    given: 'a request without a season',
    should: 'reject it',
    actual: parseOutcome(sanctionCommandSchema, {
      type: 'request-sanction',
      leagueId: id('l'),
      eventId: id('v'),
      templateId: id('t'),
    }).issues,
    expected: ['seasonId'],
  });

  assert({
    given: 'a withdrawal with a blank reason',
    should: 'reject the reason',
    actual: parseOutcome(sanctionCommandSchema, {
      ...valid['withdraw-sanction'],
      reason: '   ',
    }).issues,
    expected: ['reason'],
  });

  assert({
    given: 'an approval naming a sanction id that is not a cuid2',
    should: 'reject the id',
    actual: parseOutcome(sanctionCommandSchema, {
      type: 'approve-sanction',
      sanctionId: 'S-1',
    }).issues,
    expected: ['sanctionId'],
  });

  assert({
    given: 'a decline with an unknown key',
    should: 'reject it (strict)',
    actual: parseOutcome(sanctionCommandSchema, {
      ...valid['decline-sanction'],
      mismatches: ['format'],
    }).issues,
    expected: ['(root)'],
  });
});

test('sanction catalogue', () => {
  const definitions = Object.values(sanctionCommandCatalogue);
  assert({
    given: 'the catalogue',
    should: 'define every sanction command',
    actual: Object.keys(sanctionCommandCatalogue).sort(),
    expected: Object.keys(valid).sort(),
  });
  assert({
    given: 'every definition',
    should: 'name a gate, a history entry and only refusals of the group list',
    actual: definitions.every(
      (definition) =>
        definition.gate.length > 0 &&
        definition.history === 'entry' &&
        definition.refusals.every((refusal) =>
          (sanctionCommandRefusals as readonly string[]).includes(refusal),
        ),
    ),
    expected: true,
  });
  assert({
    given: 'the group refusal list',
    should: 'have each refusal given by some command',
    actual: sanctionCommandRefusals.filter(
      (refusal) =>
        !definitions.some((definition) =>
          (definition.refusals as readonly string[]).includes(refusal),
        ),
    ),
    expected: [],
  });
});
