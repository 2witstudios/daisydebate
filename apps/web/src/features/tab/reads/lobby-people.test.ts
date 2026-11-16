import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { LobbyPeopleFacts } from '@daisy/db/tab';
import { lobbyPeopleOf } from './lobby-people';

setupRitewayBun();
const id = (c: string) => c.repeat(24);
const now = '2026-11-16T12:00:00.000Z';
const role = {
  id: id('r'),
  organizationId: id('d'),
  name: 'Tab staff',
  rank: 2,
  preset: true,
  permissions: ['lobby.announce' as const],
};
const grant = {
  id: id('g'),
  userId: id('u'),
  scopeKind: 'lobby' as const,
  organizationId: null,
  lobbyId: id('l'),
  lobbyName: 'Open',
  grantedAt: now,
  expiresAt: null,
  revokedAt: null,
  role,
};
const facts: LobbyPeopleFacts = {
  lobby: {
    id: id('l'),
    version: 4,
    name: 'Open',
    kind: 'tournament',
    ownerOrganizationId: null,
    ownerUserId: id('o'),
  },
  ownerUserId: id('o'),
  ownerActorId: id('a'),
  people: [
    { userId: id('o'), name: 'Owner' },
    { userId: id('u'), name: 'Nonmember staff' },
  ],
  grants: [
    grant,
    { ...grant, id: id('e'), expiresAt: now },
    { ...grant, id: id('x'), lobbyId: id('x') },
  ],
  roles: [role],
  authorization: {
    account: null,
    organization: null,
    grants: [],
    membership: null,
  },
  checkedAt: now,
};

test('lobby People contains its owner and exact live grants without membership concepts', () => {
  const view = lobbyPeopleOf(facts, now, true, () => true);
  assert({
    given:
      'an owner and nonmember recipient with live, expired and foreign grants',
    should:
      'show only the live exact-lobby grant, immutable owner and actual guard',
    actual: [
      view.version,
      view.people.map((p) => [
        p.owner,
        p.removable,
        p.grants.map((g) => [g.grantId, g.removable]),
      ]),
      view.roles[0]?.giveable,
    ],
    expected: [
      4,
      [
        [true, false, []],
        [false, true, [[id('g'), true]]],
      ],
      true,
    ],
  });
});

test('lobby People cannot advertise removing or giving a role the evaluator refuses', () => {
  const view = lobbyPeopleOf(facts, now, true, () => false);
  assert({
    given:
      'broad role management without permission to give or remove this role',
    should: 'retain its label while refusing both role-specific controls',
    actual: [view.people.map((p) => p.removable), view.roles[0]?.giveable],
    expected: [[false, false], false],
  });
});

test('lobby People supports a lower grant removal without offering a higher grant or a foreign role', () => {
  const high = { ...role, id: id('h'), rank: 1 };
  const foreign = {
    ...role,
    id: id('f'),
    preset: false,
    organizationId: id('f'),
  };
  const view = lobbyPeopleOf(
    {
      ...facts,
      roles: [role, high, foreign],
      grants: [grant, { ...grant, id: id('h'), role: high }],
    },
    now,
    true,
    (given) => given.rank > 1,
  );
  assert({
    given:
      'a recipient holding a removable staff grant and an unremovable higher role',
    should:
      'show only the lower removal and never offer a custom role from another organization',
    actual: [
      view.people[1]?.removable,
      view.people[1]?.grants.map((g) => g.removable),
      view.roles.map((r) => r.giveable),
    ],
    expected: [true, [true, false], [true, false, false]],
  });
});
