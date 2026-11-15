import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { LoadedOrganizationCommand } from '@daisy/db/tab';
import { CommandDenied } from '../commands/run-command';
import type { TabPrincipal } from '../tab-principal';
import { organizationAuthorityOf } from './organization-authority';

setupRitewayBun();

const id = (c: string) => c.repeat(24);
const principal: TabPrincipal = {
  kind: 'user',
  userId: id('u'),
  actorId: id('a'),
};
const organization = {
  kind: 'organization' as const,
  organizationId: id('o'),
  organizationKind: 'league' as const,
  ownerActorIds: [id('w')],
  member: true,
  standingLobbyIds: [],
};
const account = {
  userId: id('u'),
  actorId: id('a'),
  member: true,
  erased: false,
  revision: 1,
  beta: { state: 'approved' as const, revision: 1 },
  ageBand: 'adult' as const,
  restricted: false,
  boundary: null,
};
const loaded = (
  overrides: Partial<LoadedOrganizationCommand['authorization']> = {},
  roleNamed: LoadedOrganizationCommand['roleNamed'] = null,
): LoadedOrganizationCommand => ({
  decision: {} as LoadedOrganizationCommand['decision'],
  authorization: {
    account,
    organization,
    grants: [],
    membership: 'active',
    ...overrides,
  },
  roleNamed,
});
const now = '2027-03-06T08:00:00.000Z';
const authority = (
  command: Parameters<typeof organizationAuthorityOf>[1],
  from = loaded(),
  hostingPlan = false,
) => organizationAuthorityOf(principal, command, from, { now, hostingPlan });

describe('organizationAuthorityOf', () => {
  test("a minor's boundary", () => {
    const boundary = {
      allowedLobbyIds: [id('l')],
      entryLobbyIds: [],
      revision: 2,
    };
    assert({
      given: 'a sender whose guardian limits them to one lobby',
      should: 'hand the evaluator the boundary on the account',
      actual: authority(
        { type: 'accept-membership', organizationId: id('o') },
        loaded({ account: { ...account, ageBand: '16-17', boundary } }),
      ).context.account?.boundary,
      expected: boundary,
    });
  });
  test('creating', () => {
    const input = authority(
      {
        type: 'create-organization',
        kind: 'league',
        name: 'Valley',
        handle: 'valley',
      },
      loaded({ organization: null, membership: null }),
      true,
    );
    assert({
      given: 'a create-organization command from a hosting-plan account',
      should: 'ask about the collection, with the hosting plan on the account',
      actual: [input.resource, input.context.account?.hostingPlan],
      expected: [
        { kind: 'organization_collection', proposedKind: 'league' },
        true,
      ],
    });
  });
  test("answering one's own invitation", () => {
    assert({
      given: 'an accept-membership command',
      should: "ask about the sender's own membership",
      actual: authority(
        { type: 'accept-membership', organizationId: id('o') },
        loaded({ membership: 'invited' }),
      ).resource,
      expected: {
        kind: 'membership',
        organizationId: id('o'),
        actorId: id('a'),
        status: 'invited',
      },
    });
  });
  test("ending someone else's membership", () => {
    const input = authority({
      type: 'end-membership',
      organizationId: id('o'),
      userId: id('x'),
    });
    assert({
      given: 'an end-membership command naming someone else',
      should: 'ask about the organization, weighing no particular role',
      actual: [input.resource, input.context.roleGiven],
      expected: [organization, null],
    });
  });
  test('giving a role', () => {
    const role = { permissions: ['lobby.announce' as const], roleRank: -2 };
    assert({
      given: 'a give-grant command',
      should: 'weigh the role it gives',
      actual: authority(
        {
          type: 'give-grant',
          userId: id('x'),
          roleId: id('r'),
          scope: { kind: 'organization', organizationId: id('o') },
          expiresAt: null,
        },
        loaded({}, role),
      ).context.roleGiven,
      expected: role,
    });
  });
  test('renaming', () => {
    assert({
      given: 'an update-organization command',
      should: 'ask about no role at all',
      actual:
        'roleGiven' in
        authority({
          type: 'update-organization',
          organizationId: id('o'),
          name: 'Valley',
        }).context,
      expected: false,
    });
  });
  test('an organization that is not there', () => {
    let denied: unknown = null;
    try {
      authority(
        { type: 'update-organization', organizationId: id('o'), name: 'V' },
        loaded({ organization: null }),
      );
    } catch (error) {
      denied = error;
    }
    assert({
      given: 'a command naming no stored organization',
      should: 'answer as not found',
      actual: denied instanceof CommandDenied && denied.message,
      expected: 'not-found',
    });
  });
});
