import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  peopleCommandEnvelope,
  peopleCommandValues,
  peopleCommandAnswered,
  peopleCommandFields,
} from './organization-people-forms';
setupRitewayBun();
const id = (c: string) => c.repeat(24);
const context = {
  organizationId: id('o'),
  organizationVersion: 7,
  lobbies: [{ lobbyId: id('l'), version: 11 }],
  commandId: id('c'),
  handle: 'league',
  intent: 'give',
} as const;
const form = () => {
  const values = new FormData();
  for (const [key, value] of Object.entries({
    userId: id('u'),
    roleId: id('r'),
    scope: id('l'),
    expiresAt: '2027-01-02T12:30',
  }))
    values.set(key, value);
  return values;
};
test('giving a role binds the displayed guard, actual identities and explicit UTC expiry', () => {
  assert({
    given:
      'a person, preset role, lobby and expiry selected on organization version7 and lobby version11',
    should:
      'retain the displayed version and selected scope in the portable command',
    actual: peopleCommandEnvelope(context, form()),
    expected: {
      version: 1,
      commandId: id('c'),
      expected: { lobby: 11 },
      command: {
        type: 'give-grant',
        userId: id('u'),
        roleId: id('r'),
        scope: { kind: 'lobby', lobbyId: id('l') },
        expiresAt: '2027-01-02T12:30:00Z',
      },
    },
  });
});
test('ending a role cannot switch the bound person grant list or hide duplicate fields', () => {
  const changed = form();
  changed.set('grantId', id('x'));
  const duplicated = form();
  duplicated.append('userId', id('v'));
  const refuses = (run: () => unknown) => {
    try {
      run();
      return false;
    } catch {
      return true;
    }
  };
  assert({
    given: 'a forged grant selection and two person values',
    should: 'refuse both before making a command',
    actual: [
      refuses(() =>
        peopleCommandEnvelope(
          {
            ...context,
            intent: 'remove',
            grants: [
              { grantId: id('g'), scope: { kind: 'lobby', lobbyId: id('l') } },
            ],
          },
          changed,
        ),
      ),
      refuses(() => peopleCommandEnvelope(context, duplicated)),
    ],
    expected: [true, true],
  });
});
test('organization and removal forms keep the target guard from the displayed snapshot', () => {
  const organization = form();
  organization.set('scope', 'organization');
  const removal = form();
  removal.set('grantId', id('g'));
  removal.set('scope', 'organization');
  const removed = peopleCommandEnvelope(
    {
      ...context,
      intent: 'remove',
      grants: [
        { grantId: id('g'), scope: { kind: 'lobby', lobbyId: id('l') } },
      ],
    },
    removal,
  );
  assert({
    given:
      'an organization grant and a lobby removal with a misleading form scope',
    should:
      'use the organization snapshot for the first and the bound grant/lobby snapshot for the second',
    actual: [
      peopleCommandEnvelope(context, organization).expected,
      removed.expected,
      removed.command,
    ],
    expected: [
      { organization: 7 },
      { lobby: 11 },
      {
        type: 'remove-grant',
        scope: { kind: 'lobby', lobbyId: id('l') },
        grantId: id('g'),
      },
    ],
  });
});
test('a stale snapshot preserves every selected field for a fresh review', () => {
  const values = peopleCommandValues(form());
  assert({
    given: 'a role submission refused because people changed',
    should: 'retain its fields and explain that the page must be reloaded',
    actual: peopleCommandFields(
      peopleCommandAnswered(context, values, {
        kind: 'refused',
        refusal: 'version-conflict',
      }),
    ),
    expected: {
      values,
      error: 'People changed. Reload this page before trying again.',
      notice: null,
    },
  });
});

test('cancelling an invitation keeps its bound person and displayed membership version', () => {
  const cancellation = {
    ...context,
    intent: 'cancel' as const,
    userId: id('u'),
    membershipVersion: 3,
  };
  const forged = new FormData();
  forged.set('userId', id('x'));
  assert({
    given: 'the invitation rendered for one person and lifecycle version',
    should: 'bind that identity and guard despite unrelated form values',
    actual: peopleCommandEnvelope(cancellation, forged),
    expected: {
      version: 1,
      commandId: id('c'),
      expected: { membership: 3 },
      command: {
        type: 'cancel-membership-invitation',
        organizationId: id('o'),
        userId: id('u'),
      },
    },
  });
});
