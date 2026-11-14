import { and, asc, eq, inArray } from 'drizzle-orm';
import type { MembershipStatus } from '@daisy/protocol/lobby';
import { memberships, organizations } from '../schema/organizations';
import { users } from '../schema/users';
import type { TenantScope } from '../tenant-scope';
import type { GrantRow } from './grant-rows';
import { loadOrganizationGrantRows } from './organization-grant-rows';
import {
  loadOrganizationAuthorization,
  type OrganizationAuthorization,
} from './organization-authorization';
import {
  loadStaffMinimumBand,
  type MembershipRow,
  type OrganizationRow,
} from './organization-facts';
import { loadOfferedRoles, type RoleRow } from './role-rows';
import type { TabTransaction } from './tab-transaction';

/** One member, by their public name, with the grants they hold here. */
export type OrganizationPersonRow = {
  readonly userId: string;
  readonly name: string;
  readonly membership: MembershipStatus;
  readonly grants: readonly GrantRow[];
};

/** What the people read projects from, with the viewer's authority. */
export type OrganizationPeopleFacts = {
  readonly organization: OrganizationRow;
  readonly people: readonly OrganizationPersonRow[];
  readonly roles: readonly RoleRow[];
  readonly authorization: OrganizationAuthorization;
};

/** People still in an organization: invited or active. */
const present: readonly MembershipStatus[] = ['invited', 'active'];

/**
 * An organization's people, in the transaction the fence scoped to it:
 * invited and active members by username, their live and ended grants at
 * the organization and its lobbies, the roles it may give, and the
 * viewer's authority.
 */
export const loadOrganizationPeople = async (
  tx: TabTransaction,
  input: { readonly viewerUserId: string; readonly organizationId: string },
  scope: TenantScope,
): Promise<OrganizationPeopleFacts | null> => {
  const [organization] = await tx
    .select({
      id: organizations.id,
      kind: organizations.kind,
      name: organizations.name,
      handle: organizations.handle,
      ownerUserId: organizations.ownerUserId,
      version: organizations.version,
    })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId));
  if (organization === undefined) return null;
  const members = await tx
    .select({
      organizationId: memberships.organizationId,
      userId: memberships.userId,
      status: memberships.status,
      version: memberships.version,
      username: users.username,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, organization.id),
        inArray(memberships.status, [...present]),
      ),
    )
    .orderBy(asc(memberships.createdAt), asc(memberships.userId));
  const userIds = [
    ...new Set([input.viewerUserId, ...members.map((row) => row.userId)]),
  ];
  const grants = await loadOrganizationGrantRows(tx, scope, {
    organizationId: organization.id,
    userIds,
  });
  const viewerMemberships: readonly MembershipRow[] = members.filter(
    (row) => row.userId === input.viewerUserId,
  );
  return {
    organization,
    people: members.map((row) => ({
      userId: row.userId,
      name: row.username ?? row.userId,
      membership: row.status,
      grants: grants.filter((grant) => grant.userId === row.userId),
    })),
    roles: await loadOfferedRoles(tx, organization.id),
    authorization: await loadOrganizationAuthorization(tx, scope, {
      userId: input.viewerUserId,
      organization,
      grants,
      memberships: viewerMemberships,
      staffMinimumBand: await loadStaffMinimumBand(tx, organization.id),
    }),
  };
};
