import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createTournamentAnswer,
  createTournamentEnvelope,
  freestyleEventEnvelope,
  runCreateTournament,
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
    should:
      'create a tournament the sender owns, an Open one admitting no minors',
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
    given: 'the Youth division',
    should: 'declare that the tournament admits minors and carry the division',
    actual: (({ division, envelope }) => [
      division,
      envelope.command.type === 'create-lobby' &&
        envelope.command.lobby.kind === 'tournament' &&
        envelope.command.lobby.admitsMinors,
    ])(createTournamentEnvelope(context, form('Winter Classic', 'youth'))!),
    expected: ['youth', true],
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

test('runCreateTournament', async () => {
  const lobby = {
    kind: 'accepted' as const,
    lobbyId: 'l'.padEnd(24, '1'),
    version: 1,
  };
  const sent: string[] = [];
  const ports = (setting: 'accepted' | 'refused') => ({
    lobbyCommand: async (envelope: unknown) => {
      sent.push((envelope as { command: { type: string } }).command.type);
      return lobby;
    },
    settingCommand: async (envelope: unknown) => {
      sent.push((envelope as { command: { key: string } }).command.key);
      return setting === 'accepted'
        ? lobby
        : { kind: 'refused' as const, values: {}, error: 'Refused' };
    },
  });
  const refusedYouth = await runCreateTournament(
    ports('refused'),
    context,
    form('Winter Classic', 'youth'),
  );
  const refusedSteps = [...sent];
  sent.length = 0;
  const youth = await runCreateTournament(
    ports('accepted'),
    context,
    form('Winter Classic', 'youth'),
  );
  const youthSteps = [...sent];
  sent.length = 0;
  const open = await runCreateTournament(
    ports('refused'),
    context,
    form('Spring Open', 'open'),
  );
  assert({
    given:
      'a Youth tournament whose division write is refused, one whose write succeeds, and an Open one',
    should:
      'not move on without the division (no event added), make the Youth one with its division, and make the Open one with no setting write',
    actual: {
      refused: refusedYouth.kind,
      refusedSteps,
      youth: youth.kind,
      youthSteps,
      open: open.kind,
      openSteps: sent,
    },
    expected: {
      refused: 'unacknowledged',
      refusedSteps: ['create-lobby', 'entry.age_division'],
      youth: 'made',
      youthSteps: ['create-lobby', 'entry.age_division', 'add-event'],
      open: 'made',
      openSteps: ['create-lobby', 'add-event'],
    },
  });
});
