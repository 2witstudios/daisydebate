import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  lobbyPeopleCommandIntent,
  lobbyPeopleCommandEnvelope,
  lobbyPeopleCommandAnswered,
  lobbyPeopleCommandValues,
  lobbyPeopleCommandFields,
} from './lobby-people-forms';
setupRitewayBun();
const id = (c: string) => c.repeat(24);
const context = {
  lobbyId: id('l'),
  lobbyVersion: 11,
  commandId: id('c'),
  handle: 'autumn-open',
  intent: 'give',
  roles: [id('r')],
} as const;
const form = () => {
  const data = new FormData();
  data.set('username', 'Ada');
  data.set('roleId', id('r'));
  data.set('expiresAt', '2027-01-02T12:30');
  return data;
};
test('lobby role forms bind the displayed lobby and resolved username identity', () => {
  const data = form();
  data.set('scope', id('f'));
  data.set('userId', id('f'));
  assert({
    given:
      'a username resolved to a current account, plus forged posted scope and account fields',
    should:
      'send the existing grant command with only the bound lobby guard and resolved identity',
    actual: lobbyPeopleCommandEnvelope(
      context,
      lobbyPeopleCommandIntent(context, data),
      { userId: id('u') },
    ),
    expected: {
      version: 1,
      commandId: id('c'),
      expected: { lobby: 11 },
      command: {
        type: 'give-grant',
        scope: { kind: 'lobby', lobbyId: id('l') },
        userId: id('u'),
        roleId: id('r'),
        expiresAt: '2027-01-02T12:30:00Z',
      },
    },
  });
});
test('lobby role forms reject forged roles, removals and duplicate usernames', () => {
  const refused = (run: () => unknown) => {
    try {
      run();
      return false;
    } catch {
      return true;
    }
  };
  const duplicate = form();
  duplicate.append('username', 'Bea');
  const foreign = form();
  foreign.set('roleId', id('x'));
  const remove = form();
  remove.set('grantId', id('x'));
  assert({
    given:
      'a duplicate recipient, role absent from the display and foreign grant id',
    should: 'refuse before discovery or command dispatch',
    actual: [
      refused(() => lobbyPeopleCommandIntent(context, duplicate)),
      refused(() => lobbyPeopleCommandIntent(context, foreign)),
      refused(() =>
        lobbyPeopleCommandIntent(
          { ...context, intent: 'remove', grants: [id('g')] },
          remove,
        ),
      ),
    ],
    expected: [true, true, true],
  });
});
test('lobby role refusal preserves the username and explains the actual refusal', () => {
  const values = lobbyPeopleCommandValues(form());
  const fields = lobbyPeopleCommandFields(
    lobbyPeopleCommandAnswered('give', values, {
      kind: 'refused',
      refusal: 'age-band',
    }),
  );
  assert({
    given: 'a grant refused by the existing staff age-band rule',
    should:
      'retain the typed username and show the refusal rather than a success notice',
    actual: [fields.values.username, fields.error, fields.notice],
    expected: [
      'Ada',
      'That person does not meet this role’s staff age requirement.',
      null,
    ],
  });
});
