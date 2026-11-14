import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import type {
  GrantRow,
  OrganizationPeopleFacts,
  TabStore,
} from '@daisy/db/tab';
import {
  organizationReadCatalogue,
  type OrganizationPeopleView,
} from '@daisy/protocol/lobby/organization-read';
import type { TabPrincipal } from '../tab-principal';
import { gatedRead } from './gated-read';

/**
 * The `OrganizationPeopleView` read: an organization's members with the
 * grants they hold at it, the roles it may give, and what the viewer may do
 * about them. Lobby grants and recorded conflicts belong to the lobby's own
 * people read.
 */

const live = (grant: GrantRow, now: string): boolean =>
  grant.revokedAt === null &&
  (grant.expiresAt === null || Date.parse(grant.expiresAt) > Date.parse(now));

/** The highest rank (1 is the highest) among grants; none ranks below every role. */
const highestRank = (grants: readonly GrantRow[]): number =>
  Math.min(...grants.map((grant) => grant.role.rank));

/** The one projection, from stored state and the viewer's answers. */
export const organizationPeopleOf = (
  facts: OrganizationPeopleFacts,
  viewerUserId: string,
  now: string,
  managesRoles: boolean,
): OrganizationPeopleView => {
  const { organization } = facts;
  const held = (userId: string) =>
    facts.people
      .find((person) => person.userId === userId)
      ?.grants.filter(
        (grant) => grant.scopeKind === 'organization' && live(grant, now),
      ) ?? [];
  const viewerOwns = organization.ownerUserId === viewerUserId;
  const viewerRank = highestRank(held(viewerUserId));
  return {
    organizationId: organization.id,
    name: organization.name,
    people: facts.people.map((person) => {
      const grants = held(person.userId);
      const owner = organization.ownerUserId === person.userId;
      return {
        userId: person.userId,
        name: person.name,
        owner,
        membership: person.membership,
        grants: grants.map((grant) => ({
          grantId: grant.id,
          roleId: grant.role.id,
          scope: { kind: 'organization' as const },
          expiresAt: grant.expiresAt,
        })),
        conflicts: [],
        // Rule 5: only from a role ranked above every one they hold.
        removable:
          !owner &&
          managesRoles &&
          grants.length > 0 &&
          (viewerOwns || viewerRank < highestRank(grants)),
      };
    }),
    roles: facts.roles.map((role) => ({
      roleId: role.id,
      name: role.name,
      rank: role.rank,
      preset: role.preset,
      permissions: [...role.permissions],
    })),
    conflictHandling: null,
    capabilities: { give: managesRoles },
  };
};

export type OrganizationPeopleDependencies = {
  readonly store: Pick<TabStore, 'organizationPeople'>;
  readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  readonly now: () => string;
};

/** The gated read: a viewer `organization.host.read` does not allow is answered null. */
export const readOrganizationPeople =
  (dependencies: OrganizationPeopleDependencies) =>
  (
    principal: TabPrincipal,
    organizationId: string,
  ): Promise<OrganizationPeopleView | null> => {
    const now = dependencies.now();
    return gatedRead(
      dependencies.authorize,
      organizationReadCatalogue.OrganizationPeopleView,
      async () => {
        const facts = await dependencies.store.organizationPeople({
          viewerUserId: principal.userId,
          organizationId,
        });
        const organization = facts?.authorization.organization ?? null;
        if (facts === null || organization === null) return null;
        const { account, grants } = facts.authorization;
        return {
          facts,
          authority: {
            principal,
            resource: organization,
            // Giving at all: no particular role is weighed.
            context: { account, now, grants, roleGiven: null },
          },
        };
      },
      (facts, ask) =>
        organizationPeopleOf(
          facts,
          principal.userId,
          now,
          ask('organization.roles.manage'),
        ),
    );
  };
