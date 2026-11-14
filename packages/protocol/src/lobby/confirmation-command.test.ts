import { assert, setupRitewayBun, test } from 'riteway/bun';
import { parseOutcome } from '../parse-outcome.test-support';
import {
  confirmationCommandCatalogue,
  confirmationCommandEnvelopeSchema,
  confirmationCommandRefusals,
  confirmationCommandSchema,
} from './confirmation-command';

setupRitewayBun();

const id = (letter: string) => letter.repeat(24);

const valid = {
  'confirm-command': { type: 'confirm-command', pendingCommandId: id('p') },
  'decline-command': { type: 'decline-command', pendingCommandId: id('p') },
  'withdraw-command': { type: 'withdraw-command', pendingCommandId: id('p') },
  'request-conflict-waiver': {
    type: 'request-conflict-waiver',
    fixtureId: id('f'),
    capability: 'tournament.ballots.read_unreleased',
  },
} as const;

test('confirmation commands', () => {
  for (const [type, command] of Object.entries(valid))
    assert({
      given: `a valid ${type}`,
      should: 'parse to itself',
      actual: parseOutcome(confirmationCommandSchema, command),
      expected: { data: command },
    });

  const envelope = {
    version: 1,
    commandId: id('c'),
    expected: {},
    command: valid['confirm-command'],
  };
  assert({
    given: 'an envelope carrying a confirmation',
    should: 'parse to itself',
    actual: parseOutcome(confirmationCommandEnvelopeSchema, envelope),
    expected: { data: envelope },
  });

  assert({
    given: 'a waiver asked for a capability no conflict holds back',
    should: 'reject the capability',
    actual: parseOutcome(confirmationCommandSchema, {
      ...valid['request-conflict-waiver'],
      capability: 'tournament.results.enter',
    }).issues,
    expected: ['capability'],
  });

  assert({
    given: 'a confirmation without the pending command',
    should: 'reject it',
    actual: parseOutcome(confirmationCommandSchema, { type: 'confirm-command' })
      .issues,
    expected: ['pendingCommandId'],
  });

  assert({
    given: 'a confirmation carrying a payload to apply',
    should:
      'reject it (strict: the stored command is applied, never a new one)',
    actual: parseOutcome(confirmationCommandSchema, {
      ...valid['confirm-command'],
      payload: { type: 'assign-judge' },
    }).issues,
    expected: ['(root)'],
  });
});

test('confirmation catalogue', () => {
  const definitions = Object.values(confirmationCommandCatalogue);
  assert({
    given: 'the catalogue',
    should: 'define every confirmation command',
    actual: Object.keys(confirmationCommandCatalogue).sort(),
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
          (confirmationCommandRefusals as readonly string[]).includes(refusal),
        ),
    ),
    expected: true,
  });
  assert({
    given: 'the group refusal list',
    should: 'have each refusal given by some command',
    actual: confirmationCommandRefusals.filter(
      (refusal) =>
        !definitions.some((definition) =>
          (definition.refusals as readonly string[]).includes(refusal),
        ),
    ),
    expected: [],
  });
  assert({
    given: 'confirm-command',
    should: 'refuse a closed or no longer authorized proposer by name',
    actual: ['proposer-closed', 'proposer-unauthorized'].every((refusal) =>
      (
        confirmationCommandCatalogue['confirm-command']
          .refusals as readonly string[]
      ).includes(refusal),
    ),
    expected: true,
  });
});
