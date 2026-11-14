import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { OrganizationCommand } from '@daisy/protocol/lobby/organization-command';
import {
  decideOrganization,
  type GrantFact,
  type OrganizationFacts,
  type RoleFact,
} from './organization';

setupRitewayBun();

const now = '2026-11-14T12:00:00.000Z';
const organizationId = 'league';
const role = (
  id: string,
  rank: number,
  permissions: RoleFact['permissions'],
): RoleFact => ({
  id,
  organizationId: 'daisy',
  rank,
  preset: true,
  permissions,
});
const director = role('director', 2, [
  'organization.roles.manage',
  'lobby.setup.manage',
  'tournament.draw.edit',
]);
const tabStaff = role('tab', 3, ['tournament.draw.edit']);
const grant = (
  overrides: Partial<GrantFact> & Pick<GrantFact, 'id' | 'userId' | 'role'>,
): GrantFact => ({
  scopeKind: 'organization',
  organizationId,
  lobbyId: null,
  expiresAt: null,
  revokedAt: null,
  scopeOrganizationId: organizationId,
  ...overrides,
});
const facts = (
  overrides: Partial<OrganizationFacts> = {},
): OrganizationFacts => ({
  now,
  senderUserId: 'admin',
  newId: 'new',
  organization: {
    id: organizationId,
    kind: 'league',
    name: 'Valley League',
    handle: 'valley',
    ownerUserId: 'owner',
    version: 4,
  },
  handleTaken: false,
  memberships: [
    { organizationId, userId: 'admin', status: 'active', version: 1 },
    { organizationId, userId: 'member', status: 'active', version: 2 },
  ],
  grants: [grant({ id: 'admin-grant', userId: 'admin', role: director })],
  role: tabStaff,
  lobbyOwnerOrganizationId: organizationId,
  personAgeBand: 'adult',
  staffMinimumBand: 'adult',
  ...overrides,
});
const refusalOf = (given: OrganizationFacts, command: OrganizationCommand) => {
  const decision = decideOrganization(given, command);
  return decision.kind === 'refused' ? decision.refusal : 'accepted';
};
const writesOf = (given: OrganizationFacts, command: OrganizationCommand) => {
  const decision = decideOrganization(given, command);
  return decision.kind === 'accepted' ? decision.writes : decision.refusal;
};
const orgBump = {
  table: 'organizations',
  op: 'update',
  id: organizationId,
  set: { version: 5 },
} as const;

const give = {
  type: 'give-grant',
  organizationId,
  userId: 'member',
  roleId: 'tab',
  scope: { kind: 'organization' },
  expiresAt: null,
} as const satisfies OrganizationCommand;

describe('decideOrganization', () => {
  test('creating an organization', () => {
    const create = {
      type: 'create-organization',
      kind: 'school',
      name: 'Hill School',
      handle: 'hill',
    } as const;
    assert({
      given: 'a free handle',
      should:
        'make the organization with its sender as owner and member, and no role',
      actual: decideOrganization(facts({ organization: null }), create),
      expected: {
        kind: 'accepted',
        aggregate: { kind: 'organization', id: 'new' },
        resultingVersion: 1,
        writes: [
          {
            table: 'organizations',
            op: 'insert',
            row: {
              id: 'new',
              kind: 'school',
              name: 'Hill School',
              handle: 'hill',
              ownerUserId: 'admin',
            },
          },
          {
            table: 'memberships',
            op: 'insert',
            row: {
              organizationId: 'new',
              userId: 'admin',
              status: 'active',
              joinedAt: now,
            },
          },
        ],
        findings: [],
        fixtureChanges: [],
      },
    });
    assert({
      given: 'a handle another organization holds',
      should: 'refuse handle-taken',
      actual: refusalOf(
        facts({ organization: null, handleTaken: true }),
        create,
      ),
      expected: 'handle-taken',
    });
  });

  test('an organization the facts do not hold', () => {
    assert({
      given: 'a command naming another organization',
      should: 'refuse not-found',
      actual: refusalOf(facts(), {
        type: 'update-organization',
        organizationId: 'other',
        name: 'X',
      }),
      expected: 'not-found',
    });
    assert({
      given: 'an update',
      should: 'change the name and move the version',
      actual: writesOf(facts(), {
        type: 'update-organization',
        organizationId,
        name: 'Hill',
      }),
      expected: [{ ...orgBump, set: { name: 'Hill', version: 5 } }],
    });
  });

  test('membership', () => {
    const invite = {
      type: 'invite-member',
      organizationId,
      userId: 'guest',
    } as const;
    assert({
      given: 'an invitation to a new person, and to a person who left',
      should: 'insert an invited row, or reopen the one row',
      actual: [
        writesOf(facts(), invite),
        writesOf(
          facts({
            memberships: [
              { organizationId, userId: 'guest', status: 'ended', version: 3 },
            ],
          }),
          invite,
        ),
      ],
      expected: [
        [
          orgBump,
          {
            table: 'memberships',
            op: 'insert',
            row: {
              organizationId,
              userId: 'guest',
              status: 'invited',
              joinedAt: null,
            },
          },
        ],
        [
          orgBump,
          {
            table: 'memberships',
            op: 'update',
            key: { organizationId, userId: 'guest' },
            set: {
              status: 'invited',
              joinedAt: null,
              endedAt: null,
              version: 4,
            },
          },
        ],
      ],
    });
    assert({
      given: 'an invitation to someone invited or active',
      should: 'refuse already-member',
      actual: refusalOf(facts(), { ...invite, userId: 'member' }),
      expected: 'already-member',
    });

    const invited = facts({
      senderUserId: 'guest',
      memberships: [
        { organizationId, userId: 'guest', status: 'invited', version: 1 },
      ],
    });
    assert({
      given: 'an open invitation accepted, or declined',
      should: 'make the membership active from now, or declined',
      actual: [
        writesOf(invited, { type: 'accept-membership', organizationId })[1],
        writesOf(invited, { type: 'decline-membership', organizationId })[1],
      ],
      expected: [
        {
          table: 'memberships',
          op: 'update',
          key: { organizationId, userId: 'guest' },
          set: { status: 'active', joinedAt: now, endedAt: null, version: 2 },
        },
        {
          table: 'memberships',
          op: 'update',
          key: { organizationId, userId: 'guest' },
          set: {
            status: 'declined',
            joinedAt: null,
            endedAt: null,
            version: 2,
          },
        },
      ],
    });
    assert({
      given: 'an answer with no open invitation',
      should: 'refuse invitation-closed',
      actual: refusalOf(facts({ senderUserId: 'member' }), {
        type: 'accept-membership',
        organizationId,
      }),
      expected: 'invitation-closed',
    });
  });

  test('ending a membership', () => {
    const memberGrant = grant({
      id: 'member-grant',
      userId: 'member',
      role: tabStaff,
    });
    const end = {
      type: 'end-membership',
      organizationId,
      userId: 'member',
    } as const;
    assert({
      given: 'a member ranked below the sender',
      should:
        'end the membership and its grants in the same step, and move their revision',
      actual: writesOf(
        facts({ grants: [...facts().grants, memberGrant] }),
        end,
      ),
      expected: [
        orgBump,
        {
          table: 'memberships',
          op: 'update',
          key: { organizationId, userId: 'member' },
          set: { status: 'ended', endedAt: now, version: 3 },
        },
        {
          table: 'grants',
          op: 'update',
          id: 'member-grant',
          set: { revokedAt: now, revokedByUserId: 'admin' },
        },
        { table: 'users', op: 'update', id: 'member', increment: 'version' },
      ],
    });
    assert({
      given:
        'a member ranked at or above the sender, the owner, and a non-member',
      should: 'refuse outranked, last-owner and not-a-member',
      actual: [
        refusalOf(
          facts({
            grants: [
              ...facts().grants,
              grant({ id: 'peer', userId: 'member', role: director }),
            ],
          }),
          end,
        ),
        refusalOf(
          facts({
            memberships: [
              ...facts().memberships,
              { organizationId, userId: 'owner', status: 'active', version: 1 },
            ],
          }),
          { ...end, userId: 'owner' },
        ),
        refusalOf(facts(), { ...end, userId: 'stranger' }),
      ],
      expected: ['outranked', 'last-owner', 'not-a-member'],
    });
    assert({
      given: 'a member leaving whatever their rank',
      should: 'accept',
      actual: refusalOf(
        facts({
          senderUserId: 'member',
          grants: [grant({ id: 'peer', userId: 'member', role: director })],
        }),
        end,
      ),
      expected: 'accepted',
    });
  });

  test('giving a grant (rule 5)', () => {
    assert({
      given:
        'a role below the giver whose permissions they hold, to an adult member',
      should: 'insert the grant and move the person’s revision',
      actual: writesOf(facts(), give),
      expected: [
        orgBump,
        {
          table: 'grants',
          op: 'insert',
          row: {
            id: 'new',
            roleId: 'tab',
            userId: 'member',
            scopeKind: 'organization',
            organizationId,
            lobbyId: null,
            grantedByUserId: 'admin',
            grantedAt: now,
            expiresAt: null,
          },
        },
        { table: 'users', op: 'update', id: 'member', increment: 'version' },
      ],
    });
    assert({
      given: 'a lobby-scope grant to a person who is not a member',
      should: 'give it at the lobby',
      actual: writesOf(facts(), {
        ...give,
        userId: 'visitor',
        scope: { kind: 'lobby', lobbyId: 'cup' },
      })[1],
      expected: {
        table: 'grants',
        op: 'insert',
        row: {
          id: 'new',
          roleId: 'tab',
          userId: 'visitor',
          scopeKind: 'lobby',
          organizationId: null,
          lobbyId: 'cup',
          grantedByUserId: 'admin',
          grantedAt: now,
          expiresAt: null,
        },
      },
    });
    assert({
      given: 'each way rule 5 and the grant rules can fail',
      should: 'refuse each with its name',
      actual: [
        refusalOf(facts({ role: null }), give),
        refusalOf(
          facts({
            role: { ...tabStaff, preset: false, organizationId: 'elsewhere' },
          }),
          give,
        ),
        refusalOf(facts({ lobbyOwnerOrganizationId: 'elsewhere' }), {
          ...give,
          scope: { kind: 'lobby', lobbyId: 'cup' },
        }),
        refusalOf(facts({ grants: [] }), give),
        refusalOf(
          facts({
            grants: [
              grant({
                id: 'expired',
                userId: 'admin',
                role: director,
                expiresAt: now,
              }),
            ],
          }),
          give,
        ),
        refusalOf(
          facts({ role: role('results', 3, ['tournament.results.enter']) }),
          give,
        ),
        refusalOf(
          facts({ role: role('peer', 2, ['tournament.draw.edit']) }),
          give,
        ),
        refusalOf(facts(), { ...give, userId: 'stranger' }),
        refusalOf(facts({ personAgeBand: '16-17' }), give),
        refusalOf(
          facts({
            senderUserId: 'owner',
            personAgeBand: '16-17',
            staffMinimumBand: '16-17',
            role: role('roster', 3, ['school.roster.manage']),
          }),
          give,
        ),
        refusalOf(facts(), { ...give, expiresAt: now }),
        refusalOf(
          facts({
            grants: [
              ...facts().grants,
              grant({ id: 'held', userId: 'member', role: tabStaff }),
            ],
          }),
          give,
        ),
      ],
      expected: [
        'role-unavailable',
        'role-unavailable',
        'scope-not-covered',
        'scope-not-covered',
        'scope-not-covered',
        'permission-not-held',
        'role-not-below',
        'not-a-member',
        'age-band',
        'age-band',
        'expiry-passed',
        'already-granted',
      ],
    });
    assert({
      given: 'the owner, with no grant, giving a role ranked anywhere',
      should: 'accept, and a 16-17 member where the organization allows it',
      actual: [
        refusalOf(
          facts({
            senderUserId: 'owner',
            grants: [],
            role: role('top', 1, ['organization.manage']),
          }),
          give,
        ),
        refusalOf(
          facts({ personAgeBand: '16-17', staffMinimumBand: '16-17' }),
          give,
        ),
      ],
      expected: ['accepted', 'accepted'],
    });
  });

  test('removing a grant', () => {
    const remove = {
      type: 'remove-grant',
      organizationId,
      grantId: 'member-grant',
    } as const;
    const withGrant = (target: Partial<GrantFact>) =>
      facts({
        grants: [
          ...facts().grants,
          grant({
            id: 'member-grant',
            userId: 'member',
            role: tabStaff,
            ...target,
          }),
        ],
      });
    assert({
      given: 'a live grant ranked below the sender',
      should: 'revoke it and move the person’s revision',
      actual: writesOf(withGrant({}), remove),
      expected: [
        orgBump,
        {
          table: 'grants',
          op: 'update',
          id: 'member-grant',
          set: { revokedAt: now, revokedByUserId: 'admin' },
        },
        { table: 'users', op: 'update', id: 'member', increment: 'version' },
      ],
    });
    assert({
      given:
        'a revoked grant, one ranked at the sender, and one of another organization',
      should: 'refuse grant-ended, outranked and not-found',
      actual: [
        refusalOf(withGrant({ revokedAt: now }), remove),
        refusalOf(withGrant({ role: director }), remove),
        refusalOf(withGrant({ scopeOrganizationId: 'elsewhere' }), remove),
      ],
      expected: ['grant-ended', 'outranked', 'not-found'],
    });
  });

  test('transferring ownership', () => {
    const transfer = {
      type: 'transfer-ownership',
      organizationId,
      userId: 'member',
    } as const;
    assert({
      given: 'an active member, and someone who is not',
      should: 'make the member owner, and refuse not-a-member',
      actual: [
        writesOf(facts(), transfer),
        refusalOf(facts(), { ...transfer, userId: 'stranger' }),
      ],
      expected: [
        [{ ...orgBump, set: { ownerUserId: 'member', version: 5 } }],
        'not-a-member',
      ],
    });
  });
});
