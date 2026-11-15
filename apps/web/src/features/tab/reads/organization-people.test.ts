import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { GrantRow, OrganizationPeopleFacts } from '@daisy/db/tab';
import { organizationPeopleOf } from './organization-people';

setupRitewayBun();

const id = (c: string) => c.repeat(24);
const now = '2027-03-06T08:00:00.000Z';
const role = (rank: number, name: string) => ({
  id: id(String(rank)),
  organizationId: id('d'),
  name,
  rank,
  preset: true,
  permissions: ['lobby.announce' as const],
});
const grant = (
  userId: string,
  rank: number,
  overrides: Partial<GrantRow> = {},
): GrantRow => ({
  id: id('g'),
  userId,
  scopeKind: 'organization',
  organizationId: id('o'),
  lobbyId: null,
  lobbyName: null,
  grantedAt: now,
  expiresAt: null,
  revokedAt: null,
  role: role(rank, rank === 1 ? 'Director' : 'Staff'),
  ...overrides,
});
const facts = (
  people: OrganizationPeopleFacts['people'],
): OrganizationPeopleFacts => ({
  organization: {
    id: id('o'),
    kind: 'league',
    name: 'Valley League',
    handle: 'valley',
    ownerUserId: id('w'),
    version: 3,
  },
  people,
  lobbies: [],
  roles: [role(1, 'Director'), role(2, 'Staff')],
  authorization: {
    account: null,
    organization: null,
    grants: [],
    membership: null,
  },
});
const person = (userId: string, grants: readonly GrantRow[] = []) => ({
  userId,
  name: `bot-${userId}`,
  membership: 'active' as const,
  membershipVersion: 1,
  grants,
});

describe('organizationPeopleOf', () => {
  const owner = person(id('w'));
  const staff = person(id('s'), [grant(id('s'), 2)]);
  test('the owner reads', () => {
    const view = organizationPeopleOf(
      facts([owner, staff]),
      id('w'),
      now,
      true,
    );
    assert({
      given: 'the owner who manages roles',
      should: 'show the owner unremovable and Staff removable with the role',
      actual: view.people.map((one) => [
        one.owner,
        one.removable,
        one.grants.map((given) => given.roleId),
      ]),
      expected: [
        [true, false, []],
        [false, true, [id('2')]],
      ],
    });
  });
  test('an ended and an expired grant', () => {
    const view = organizationPeopleOf(
      facts([
        person(id('s'), [
          grant(id('s'), 2, { revokedAt: now }),
          grant(id('s'), 1, { expiresAt: now }),
        ]),
      ]),
      id('w'),
      now,
      true,
    );
    assert({
      given: 'grants revoked or expired by now',
      should: 'show none, and nothing to remove',
      actual: [view.people[0]?.grants, view.people[0]?.removable],
      expected: [[], false],
    });
  });
  test('a viewer ranked no higher', () => {
    const peer = person(id('p'), [grant(id('p'), 2, { id: id('q') })]);
    const view = organizationPeopleOf(facts([staff, peer]), id('s'), now, true);
    assert({
      given: 'Staff viewing another Staff',
      should: 'not let them remove an equal',
      actual: view.people.map((one) => one.removable),
      expected: [false, false],
    });
  });
  test('a viewer who does not manage roles', () => {
    const view = organizationPeopleOf(
      facts([owner, staff]),
      id('w'),
      now,
      false,
    );
    assert({
      given: 'a viewer the evaluator does not let give roles',
      should: 'offer no giving and no removal',
      actual: [view.capabilities.give, view.people.map((one) => one.removable)],
      expected: [false, [false, false]],
    });
  });
  test('a grant at one of its lobbies', () => {
    const lobbyGrant = grant(id('s'), 2, {
      id: id('l'),
      scopeKind: 'lobby',
      organizationId: null,
      lobbyId: id('b'),
      lobbyName: 'Spring Open',
    });
    const view = organizationPeopleOf(
      facts([owner, person(id('s'), [lobbyGrant])]),
      id('w'),
      now,
      true,
    );
    assert({
      given: 'a member whose only grant is at a lobby the league owns',
      should: 'show it at that lobby, removable by the owner',
      actual: [view.people[1]?.grants, view.people[1]?.removable],
      expected: [
        [
          {
            grantId: id('l'),
            roleId: id('2'),
            scope: { kind: 'lobby', lobbyId: id('b'), name: 'Spring Open' },
            expiresAt: null,
          },
        ],
        true,
      ],
    });
  });
  test('a viewer whose grant is at one lobby only', () => {
    const viewer = person(id('v'), [
      grant(id('v'), 1, {
        id: id('m'),
        scopeKind: 'lobby',
        organizationId: null,
        lobbyId: id('b'),
        lobbyName: 'Spring Open',
      }),
    ]);
    const view = organizationPeopleOf(
      facts([viewer, staff]),
      id('v'),
      now,
      true,
    );
    assert({
      given: 'a viewer ranked above Staff, but only at one lobby',
      should: 'not let them remove a grant at the whole league',
      actual: view.people[1]?.removable,
      expected: false,
    });
  });
});
