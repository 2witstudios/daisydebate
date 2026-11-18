import { assert, setupRitewayBun, test } from 'riteway/bun';
import { decideGrant } from './grants';
import type { GrantFact, OrganizationFacts } from './organization';
setupRitewayBun();
const lobby = {
  id: 'personal',
  kind: 'tournament' as const,
  ownerUserId: 'owner',
  ownerActorId: 'owner-actor',
  ownerOrganizationId: null,
  version: 4,
};
const role = {
  id: 'tab',
  organizationId: 'preset-publisher',
  rank: 3,
  preset: true,
  permissions: ['tournament.draw.edit'] as const,
};
const staffRole = {
  ...role,
  id: 'staff',
  rank: 2,
  permissions: ['organization.roles.manage', 'tournament.draw.edit'] as const,
};
const held = (overrides: Partial<GrantFact> = {}): GrantFact => ({
  id: 'held',
  userId: 'staff',
  scopeKind: 'lobby',
  organizationId: null,
  lobbyId: lobby.id,
  expiresAt: null,
  revokedAt: null,
  role: staffRole,
  ...overrides,
});
const facts = (
  overrides: Partial<OrganizationFacts> = {},
): OrganizationFacts => ({
  now: '2026-11-15T12:00:00.000Z',
  senderUserId: 'staff',
  newId: 'new',
  organization: null,
  lobby,
  handleTaken: false,
  memberships: [],
  grants: [held()],
  role,
  personAgeBand: 'adult',
  staffMinimumBand: 'adult',
  ...overrides,
});
const give = {
  type: 'give-grant' as const,
  scope: { kind: 'lobby' as const, lobbyId: lobby.id },
  userId: 'recipient',
  roleId: role.id,
  expiresAt: null,
};
const answer = (from: OrganizationFacts) => {
  const result = decideGrant(from, give);
  return result.kind === 'refused' ? result.refusal : result.aggregate;
};
test('personal lobby grants use their explicit target and current covering authority', () => {
  assert({
    given:
      'a personal owner, a lobby staff giver without membership, another-lobby grant, a peer role and a permission held only elsewhere',
    should:
      'allow the actual owner and covering giver while preserving scope, seniority and subset checks',
    actual: [
      answer(facts({ senderUserId: 'owner', grants: [] })),
      answer(facts()),
      answer(facts({ grants: [held({ lobbyId: 'elsewhere' })] })),
      answer(facts({ role: { ...role, rank: 2 } })),
      answer(
        facts({
          grants: [
            held({
              role: {
                ...staffRole,
                permissions: ['organization.roles.manage'],
              },
            }),
            held({ id: 'elsewhere', lobbyId: 'elsewhere' }),
          ],
        }),
      ),
    ],
    expected: [
      { kind: 'lobby', id: lobby.id },
      { kind: 'lobby', id: lobby.id },
      'scope-not-covered',
      'role-not-below',
      'permission-not-held',
    ],
  });
  const result = decideGrant(
    facts({ senderUserId: 'owner', grants: [] }),
    give,
  );
  assert({
    given: 'a preset published by an organization, given at a personal lobby',
    should: 'write only the actual lobby target and move its guard',
    actual:
      result.kind === 'accepted'
        ? [
            result.resultingVersion,
            result.writes.find(
              (write) => write.table === 'grants' && write.op === 'insert',
            ),
          ]
        : result,
    expected: [
      5,
      {
        table: 'grants',
        op: 'insert',
        row: {
          id: 'new',
          roleId: role.id,
          userId: 'recipient',
          scopeKind: 'lobby',
          organizationId: null,
          lobbyId: lobby.id,
          grantedByUserId: 'owner',
          grantedAt: '2026-11-15T12:00:00.000Z',
          expiresAt: null,
        },
      },
    ],
  });
});
test('a parent organization grant covers a lobby only with its current membership, and cannot be removed from below', () => {
  const organization = {
    id: 'league',
    kind: 'league' as const,
    name: 'League',
    handle: 'league',
    ownerUserId: 'owner',
    version: 2,
  };
  const parent = held({
    scopeKind: 'organization',
    organizationId: organization.id,
    lobbyId: null,
  });
  const from = facts({
    organization,
    lobby: {
      ...lobby,
      ownerUserId: null,
      ownerActorId: null,
      ownerOrganizationId: organization.id,
    },
    grants: [parent],
    memberships: [
      {
        organizationId: organization.id,
        userId: 'staff',
        status: 'active',
        version: 1,
      },
    ],
  });
  const removed = decideGrant(
    { ...from, senderUserId: 'owner' },
    {
      type: 'remove-grant',
      scope: { kind: 'lobby', lobbyId: lobby.id },
      grantId: parent.id,
    },
  );
  assert({
    given:
      'a current parent role, the same role after membership ends, and revocation addressed below its scope',
    should:
      'preserve inherited authority without allowing a lobby to revoke its parent role',
    actual: [
      answer(from),
      answer({
        ...from,
        memberships: [{ ...from.memberships[0]!, status: 'ended' }],
      }),
      removed,
    ],
    expected: [
      { kind: 'lobby', id: lobby.id },
      'scope-not-covered',
      { kind: 'refused', refusal: 'not-found' },
    ],
  });
});
