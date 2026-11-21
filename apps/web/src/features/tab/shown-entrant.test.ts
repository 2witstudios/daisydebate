import { assert, setupRitewayBun, test } from 'riteway/bun';
import { shownEntrantSchema } from '@daisy/protocol/lobby/posting-read';
import { showTournamentEntrant } from './shown-entrant';

setupRitewayBun();

test('the public and participant see different names for the same entrant', () => {
  const storedName = 'Érica Mora';
  assert({
    given:
      'the same stored entrant for a public viewer and authorized participant',
    should:
      'return only initials to the public and keep the registered name for the participant',
    actual: [false, true].map((allowName) =>
      shownEntrantSchema.parse(showTournamentEntrant(storedName, allowName)),
    ),
    expected: [
      { kind: 'initials', initials: 'E. M.' },
      { kind: 'name', name: storedName },
    ],
  });
});
