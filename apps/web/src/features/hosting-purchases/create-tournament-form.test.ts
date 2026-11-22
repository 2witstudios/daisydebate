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
  suffix: 'k3x9q2',
};
const form = (name: string, ageRule = 'adults') => {
  const data = new FormData();
  data.set('name', name);
  data.set('ageRule', ageRule);
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
    should: 'create an adults-only tournament the sender owns',
    actual: createTournamentEnvelope(context, form('  Friday scrimmage '))
      ?.envelope.command,
    expected: {
      type: 'create-lobby',
      owner: { kind: 'self' },
      name: 'Friday scrimmage',
      handle: 'friday-scrimmage-k3x9q2',
      lobby: {
        kind: 'tournament',
        eligibility: { kind: 'own', ageRule: 'adults' },
      },
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
    given: 'the Youth and mixed-age rules',
    should: 'set the selected rule in the creation command',
    actual: ['under-18', 'anyone'].map((ageRule) => {
      const command = createTournamentEnvelope(
        context,
        form('Winter Classic', ageRule),
      )?.envelope.command;
      return command?.type === 'create-lobby' && command.lobby;
    }),
    expected: (['under-18', 'anyone'] as const).map((ageRule) => ({
      kind: 'tournament' as const,
      eligibility: { kind: 'own' as const, ageRule },
    })),
  });
  const leagueId = 'g'.padEnd(24, '1');
  const standingLobbyId = 's'.padEnd(24, '1');
  const leagueForm = form('League Cup');
  leagueForm.delete('ageRule');
  leagueForm.set('standingLobbyId', standingLobbyId);
  assert({
    given: 'a league host selecting an existing standing lobby',
    should:
      'send the league and selected parent in the tournament creation command',
    actual: createTournamentEnvelope({ ...context, leagueId }, leagueForm)
      ?.envelope.command,
    expected: {
      type: 'create-lobby',
      owner: { kind: 'organization', organizationId: leagueId },
      name: 'League Cup',
      handle: 'league-cup-k3x9q2',
      lobby: {
        kind: 'tournament',
        eligibility: { kind: 'standing', lobbyId: standingLobbyId },
      },
    },
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
        values: { name: 'Cup', ageRule: 'adults' },
        error: 'That name is taken. Try another.',
      },
      'unacknowledged',
    ],
  });
  const standingLobbyId = 's'.padEnd(24, '1');
  const leagueForm = new FormData();
  leagueForm.set('name', 'League Cup');
  leagueForm.set('standingLobbyId', standingLobbyId);
  assert({
    given: 'a league host whose standing lobby closed before submission',
    should: 'retain the form values and tell the host to choose an open lobby',
    actual: createTournamentAnswer(leagueForm, {
      kind: 'refused',
      refusal: 'standing-lobby-required',
    }),
    expected: {
      kind: 'refused',
      values: { name: 'League Cup', standingLobbyId },
      error: 'Choose an open standing lobby from this league.',
    },
  });
});

test('runCreateTournament', async () => {
  const lobby = {
    kind: 'accepted' as const,
    lobbyId: 'l'.padEnd(24, '1'),
    version: 1,
  };
  const sent: string[] = [];
  const result = await runCreateTournament(
    {
      lobbyCommand: async (envelope: unknown) => {
        sent.push((envelope as { command: { type: string } }).command.type);
        return lobby;
      },
    },
    context,
    form('Winter Classic', 'under-18'),
  );
  assert({
    given: 'a Youth tournament created with its age rule',
    should: 'create its Freestyle event and move on',
    actual: { result: result.kind, sent },
    expected: { result: 'made', sent: ['create-lobby', 'add-event'] },
  });
});
