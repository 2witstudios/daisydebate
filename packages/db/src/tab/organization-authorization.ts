import { and, asc, eq } from 'drizzle-orm';
import type {
  MembershipStatus,
  OrganizationKind,
  Permission,
} from '@daisy/protocol/lobby';
import { actors } from '../schema/actors';
import { lobbies } from '../schema/lobbies';
import type { TenantScope } from '../tenant-scope';
import { loadTabAccount, type TabAccount } from './boundary';
import type { GrantRow } from './grant-rows';
import type { MembershipRow, OrganizationRow } from './organization-facts';
import { roleSeniority } from './role-seniority';
import type { StaffMinimumBand } from './staff-minimum-band';
import type { TabTransaction } from './tab-transaction';

/**
 * What the evaluator needs about the person asking at one organization, as
 * plain data the application assembles into its authorization input.
 */

/** A grant the person holds, as the evaluator reads it. */
export type GrantAuthority = {
  readonly grantId: string;
  readonly scope:
    | { readonly kind: 'organization'; readonly organizationId: string }
    | { readonly kind: 'lobby'; readonly lobbyId: string };
  readonly permissions: readonly Permission[];
  /** Seniority: a greater number outranks a lesser one. */
  readonly roleRank: number;
  readonly expiresAt: string | null;
  readonly membershipActive: boolean;
  readonly staffMinimumBand: StaffMinimumBand;
  readonly revision: number;
};

/** The organization, as the evaluator reads it. */
export type OrganizationAuthority = {
  readonly kind: 'organization';
  readonly organizationId: string;
  readonly organizationKind: OrganizationKind;
  readonly ownerActorIds: readonly string[];
  readonly member: boolean;
  readonly standingLobbyIds: readonly string[];
};

/** A role a command gives or removes, as the evaluator weighs it. */
export type RoleAuthority = {
  readonly permissions: readonly Permission[];
  readonly roleRank: number;
};

export type OrganizationAuthorization = {
  /** The person's account with their boundary, always loaded. */
  readonly account: TabAccount | null;
  readonly organization: OrganizationAuthority | null;
  /** The person's own unrevoked grants here and in its lobbies. */
  readonly grants: readonly GrantAuthority[];
  /** The person's own membership status here, null when they have none. */
  readonly membership: MembershipStatus | null;
};

export const roleAuthorityOf = (role: {
  readonly permissions: readonly Permission[];
  readonly rank: number;
}): RoleAuthority => ({
  permissions: role.permissions,
  roleRank: roleSeniority(role.rank),
});

/**
 * One unrevoked grant as the evaluator reads it. An organization grant
 * counts only while the membership it rests on is active; a lobby grant
 * rests on none. Its revision is the holder's account revision, which every
 * grant change moves.
 */
export const grantAuthorityOf = (
  grant: GrantRow,
  holder: {
    readonly membershipActive: boolean;
    readonly staffMinimumBand: StaffMinimumBand;
    readonly revision: number;
  },
): GrantAuthority => ({
  grantId: grant.id,
  scope:
    grant.scopeKind === 'lobby' && grant.lobbyId !== null
      ? { kind: 'lobby', lobbyId: grant.lobbyId }
      : { kind: 'organization', organizationId: grant.scopeOrganizationId },
  ...roleAuthorityOf(grant.role),
  expiresAt: grant.expiresAt,
  membershipActive: grant.scopeKind === 'lobby' || holder.membershipActive,
  staffMinimumBand: holder.staffMinimumBand,
  revision: holder.revision,
});

const loadOrganizationAuthority = async (
  tx: TabTransaction,
  organization: OrganizationRow,
  member: boolean,
): Promise<OrganizationAuthority> => {
  const owners =
    organization.ownerUserId === null
      ? []
      : await tx
          .select({ id: actors.id })
          .from(actors)
          .where(eq(actors.userId, organization.ownerUserId));
  const standing = await tx
    .select({ id: lobbies.id })
    .from(lobbies)
    .where(
      and(
        eq(lobbies.ownerOrganizationId, organization.id),
        eq(lobbies.kind, 'standing'),
      ),
    )
    .orderBy(asc(lobbies.id));
  return {
    kind: 'organization',
    organizationId: organization.id,
    organizationKind: organization.kind,
    ownerActorIds: owners.map((owner) => owner.id),
    member,
    standingLobbyIds: standing.map((lobby) => lobby.id),
  };
};

/**
 * The person's account with their boundary, the organization and the
 * person's usable grants, from the grant and membership rows already loaded
 * in this transaction, whose subject is the person.
 */
export const loadOrganizationAuthorization = async (
  tx: TabTransaction,
  scope: TenantScope,
  input: {
    readonly userId: string;
    readonly organization: OrganizationRow | null;
    readonly grants: readonly GrantRow[];
    readonly memberships: readonly MembershipRow[];
    readonly staffMinimumBand: StaffMinimumBand;
  },
): Promise<OrganizationAuthorization> => {
  const account = await loadTabAccount(tx, input.userId, scope);
  const membership =
    input.memberships.find(
      (row) =>
        row.userId === input.userId &&
        row.organizationId === input.organization?.id,
    )?.status ?? null;
  const membershipActive = membership === 'active';
  return {
    account,
    organization:
      input.organization === null
        ? null
        : await loadOrganizationAuthority(
            tx,
            input.organization,
            membershipActive,
          ),
    grants:
      account === null
        ? []
        : input.grants
            .filter(
              (grant) =>
                grant.userId === input.userId && grant.revokedAt === null,
            )
            .map((grant) =>
              grantAuthorityOf(grant, {
                membershipActive,
                staffMinimumBand: input.staffMinimumBand,
                revision: account.revision,
              }),
            ),
    membership,
  };
};
