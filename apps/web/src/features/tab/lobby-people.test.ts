import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { LobbyPeopleView } from '@daisy/protocol/lobby/lobby-people-read';
import { lobbyPeoplePage } from './lobby-people';
setupRitewayBun();
const id = (c: string) => c.repeat(24);
const view: LobbyPeopleView = {
  lobbyId: id('l'),
  version: 4,
  name: 'Autumn Open',
  people: [
    {
      userId: id('o'),
      name: 'Owner',
      owner: true,
      grants: [],
      removable: false,
    },
    {
      userId: id('u'),
      name: 'Ada',
      owner: false,
      grants: [
        { grantId: id('g'), roleId: id('r'), expiresAt: null, removable: true },
      ],
      removable: true,
    },
  ],
  roles: [
    {
      roleId: id('r'),
      name: 'Staff',
      rank: 2,
      preset: true,
      permissions: ['tournament.draw.edit'],
      giveable: true,
    },
  ],
  capabilities: { give: true },
};
test('lobby People presents grants without inventing organization memberships', () => {
  const page = lobbyPeoplePage(view, {
    role: null,
    basePath: '/host/tournaments/autumn-open/people',
    viewerId: id('u'),
  });
  assert({
    given: 'a personal lobby owner and current lobby grants',
    should:
      'show ownership and scope, use the existing role presentation and keep role navigation in this lobby',
    actual: [
      page.people.map((person) => [person.name, person.owner, person.detail]),
      page.roles[0]?.href,
      page.role.name,
      page.role.permissions.find(
        (permission) => permission.label === 'Change a draft draw',
      )?.allowed,
    ],
    expected: [
      [
        ['Owner', true, 'Owner · can’t be removed here'],
        ['You', false, 'Staff · Autumn Open only'],
      ],
      `/host/tournaments/autumn-open/people?role=${id('r')}`,
      'Staff',
      true,
    ],
  });
});

test('same-named roles retain their actual identities in the lobby selector', () => {
  const copy = {
    ...view,
    roles: [
      ...view.roles,
      {
        ...view.roles[0]!,
        roleId: id('q'),
        permissions: ['tournament.ballots.read_unreleased' as const],
      },
    ],
  };
  const page = lobbyPeoplePage(copy, {
    role: id('q'),
    basePath: '/host/tournaments/autumn-open/people',
    viewerId: id('u'),
  });
  assert({
    given: 'two distinct offered roles with the same name',
    should: 'select the actual addressed role and show its own permissions',
    actual: [
      page.roles.find((role) => role.selected)?.id,
      page.role.permissions.find(
        (permission) => permission.label === 'See ballots before release',
      )?.allowed,
    ],
    expected: [id('q'), true],
  });
});
