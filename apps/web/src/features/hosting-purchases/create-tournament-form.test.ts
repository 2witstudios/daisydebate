import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createTournamentAnswer,
  createTournamentEnvelope,
  freestyleEventEnvelope,
  tournamentHandle,
} from './create-tournament-form';

setupRitewayBun();

const context = {
  lobbyCommandId: 'a'.padEnd(24, '1'),
  eventCommandId: 'b'.padEnd(24, '1'),
  divisionCommandId: 'c'.padEnd(24, '1'),
  suffix: 'k3x9q2',
};
const form = (name: string, division = 'open') => {
  const data = new FormData();
  data.set('name', name);
  data.set('division', division);
  return data;
};

test('tournamentHandle', () => {
  assert({
    given: 'ordinary, accented, symbol-only and very long names',
    should: 'make a lower-case handle with the suffix, within the handle rule',
    actual: [
      tournamentHandle('Friday Scrimmage!', 'k3x9q2'),
      tournamentHandle('École d’été', 'k3x9q2'),
      tournamentHandle('!!!', 'k3x9q2'),
      tournamentHandle('a'.repeat(80), 'k3x9q2').length <= 48,
    ],
    expected: [
      'friday-scrimmage-k3x9q2',
      'ecole-d-ete-k3x9q2',
      'tournament-k3x9q2',
      true,
    ],
  });
});

test('createTournamentEnvelope', () => {
  assert({
    given: 'a name',
    should: 'create a tournament the sender owns, admitting no minors',
    actual: createTournamentEnvelope(context, form('  Friday scrimmage '))
      ?.envelope.command,
    expected: {
      type: 'create-lobby',
      owner: { kind: 'self' },
      name: 'Friday scrimmage',
      handle: 'friday-scrimmage-k3x9q2',
      lobby: { kind: 'tournament', admitsMinors: false },
    },
  });
  assert({
    given: 'an empty name and an overlong one',
    should: 'make no command',
    actual: [
      createTournamentEnvelope(context, form('   ')),
      createTournamentEnvelope(context, form('x'.repeat(121))),
    ],
    expected: [null, null],
  });
  assert({
    given: 'the created tournament',
    should: 'add its one Freestyle event at the lobby version it returned',
    actual: freestyleEventEnvelope(context, 'l'.padEnd(24, '1'), 1).expected,
    expected: { lobby: 1 },
  });
});

test('createTournamentAnswer', () => {
  assert({
    given: 'a taken handle and an unreadable answer',
    should: 'ask for another name, and keep the form for a retry',
    actual: [
      createTournamentAnswer(form('Cup'), {
        kind: 'refused',
        refusal: 'handle-taken',
      }),
      createTournamentAnswer(form('Cup'), { nonsense: true }).kind,
    ],
    expected: [
      {
        kind: 'refused',
        values: { name: 'Cup', division: 'open' },
        error: 'That name is taken. Try another.',
      },
      'unacknowledged',
    ],
  });
});
