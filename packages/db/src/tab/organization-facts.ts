import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { MembershipStatus, OrganizationKind } from '@daisy/protocol/lobby';
import type { OrganizationCommand } from '@daisy/protocol/lobby/organization-command';
import { loadAuthorizationAccount } from '../authorization';
import { lobbies } from '../schema/lobbies';
import { actors } from '../schema/actors';
import { loadGrantRows } from './grant-rows';
import { memberships, organizations } from '../schema/organizations';
import { settings } from '../schema/settings';
import type { GrantRow } from './grant-rows';
import { loadOrganizationGrantRows } from './organization-grant-rows';
import { loadRoles, type RoleRow } from './role-rows';
import {
  staffMinimumBandOf,
  type StaffMinimumBand,
} from './staff-minimum-band';
import type { TenantScope } from '../tenant-scope';
import type { TabTransaction } from './tab-transaction';

/** An `organizations` row, as the commands read it. */
export type OrganizationRow = {
  readonly id: string;
  readonly kind: OrganizationKind;
  readonly name: string;
  readonly handle: string;
  readonly ownerUserId: string | null;
  readonly version: number;
};

/** A `memberships` row. */
export type MembershipRow = {
  readonly organizationId: string;
  readonly userId: string;
  readonly status: MembershipStatus;
  readonly version: number;
};

/** What the organization and grant commands decide from. */
export type OrganizationCommandFacts = {
  readonly now: string;
  readonly senderUserId: string;
  readonly newId: string;
  readonly organization: OrganizationRow | null;
  readonly handleTaken: boolean;
  readonly memberships: readonly MembershipRow[];
  readonly grants: readonly GrantRow[];
  readonly role: RoleRow | null;
  readonly lobby: {
    readonly id: string;
    readonly kind: 'standing' | 'tournament';
    readonly ownerOrganizationId: string | null;
    readonly ownerUserId: string | null;
    readonly ownerActorId: string | null;
    readonly version: number;
  } | null;
  readonly personAgeBand: 'under-13' | '13-15' | '16-17' | 'adult' | null;
  readonly staffMinimumBand: StaffMinimumBand;
};

export type OrganizationCommandInput = {
  readonly senderUserId: string;
  readonly command: OrganizationCommand;
  readonly newId: string;
  readonly now: string;
};

/** The person a command names, beside its sender. */
export const namedPersonOf = (command: OrganizationCommand): string | null => {
  switch (command.type) {
    case 'invite-member':
    case 'end-membership':
    case 'give-grant':
    case 'transfer-ownership':
      return command.userId;
    case 'create-organization':
    case 'update-organization':
    case 'accept-membership':
    case 'decline-membership':
    case 'remove-grant':
      return null;
  }
};

const organizationColumns = {
  id: organizations.id,
  kind: organizations.kind,
  name: organizations.name,
  handle: organizations.handle,
  ownerUserId: organizations.ownerUserId,
  version: organizations.version,
};

/** The organization's row, locked for the command that changes it. */
export const lockOrganization = async (
  tx: TabTransaction,
  organizationId: string,
  strength: 'update' | 'share' = 'update',
): Promise<OrganizationRow | null> => {
  const [row] = await tx
    .select(organizationColumns)
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .for(strength);
  return row ?? null;
};

/** Whether another organization holds the handle, case-insensitively. */
const handleTaken = async (
  tx: TabTransaction,
  handle: string,
  organizationId: string,
): Promise<boolean> => {
  const [row] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      and(
        sql`lower(${organizations.handle}) = lower(${handle})`,
        ne(organizations.id, organizationId),
      ),
    )
    .limit(1);
  return row !== undefined;
};

/** `staff.minimum_band` resolved at this organization. */
export const loadStaffMinimumBand = async (
  tx: TabTransaction,
  organizationId: string,
): Promise<StaffMinimumBand> => {
  const [row] = await tx
    .select({ value: settings.value })
    .from(settings)
    .where(
      and(
        eq(settings.scopeKind, 'organization'),
        eq(settings.organizationId, organizationId),
        eq(settings.key, 'staff.minimum_band'),
      ),
    );
  return staffMinimumBandOf(row ?? null);
};

/** This organization's memberships of the people named. */
export const loadMemberships = async (
  tx: TabTransaction,
  organizationId: string,
  userIds: readonly string[],
): Promise<readonly MembershipRow[]> =>
  userIds.length === 0
    ? []
    : tx
        .select({
          organizationId: memberships.organizationId,
          userId: memberships.userId,
          status: memberships.status,
          version: memberships.version,
        })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            inArray(memberships.userId, [...userIds]),
          ),
        );

/** The people's memberships and grants in an organization that exists. */
const peopleRows = async (
  tx: TabTransaction,
  scope: TenantScope,
  organization: OrganizationRow | null,
  people: readonly string[],
  command: OrganizationCommand,
) =>
  organization === null
    ? { memberships: [], grants: [] }
    : {
        memberships: await loadMemberships(tx, organization.id, people),
        grants: await loadOrganizationGrantRows(tx, scope, {
          organizationId: organization.id,
          userIds: people,
          grantIds: command.type === 'remove-grant' ? [command.grantId] : [],
        }),
      };

const roleNamedOf = async (
  tx: TabTransaction,
  command: OrganizationCommand,
): Promise<RoleRow | null> => {
  if (command.type !== 'give-grant') return null;
  const [role] = await loadRoles(tx, [command.roleId]);
  return role ?? null;
};

/**
 * Loads the facts one organization or grant command decides from, in the
 * transaction the fence already scoped to `scope`, with the organization's
 * row locked.
 */
export const loadOrganizationFacts = async (
  tx: TabTransaction,
  input: OrganizationCommandInput,
  scope: TenantScope,
): Promise<OrganizationCommandFacts> => {
  const { command, senderUserId } = input;
  const organizationId =
    scope.organizationId ??
    (command.type === 'create-organization' ? input.newId : undefined);
  const organization =
    command.type === 'create-organization' || !organizationId
      ? null
      : await lockOrganization(
          tx,
          organizationId,
          scope.lobbyId ? 'share' : 'update',
        );
  const [lobbyRow] = scope.lobbyId
    ? await tx
        .select()
        .from(lobbies)
        .where(eq(lobbies.id, scope.lobbyId))
        .for('update')
    : [];
  const [lobbyOwner] = lobbyRow?.ownerUserId
    ? await tx
        .select({ id: actors.id })
        .from(actors)
        .where(eq(actors.userId, lobbyRow.ownerUserId))
    : [];
  const lobby =
    lobbyRow && lobbyRow.ownerOrganizationId === (scope.organizationId ?? null)
      ? {
          id: lobbyRow.id,
          kind: lobbyRow.kind,
          ownerOrganizationId: lobbyRow.ownerOrganizationId,
          ownerUserId: lobbyRow.ownerUserId,
          ownerActorId: lobbyOwner?.id ?? null,
          version: lobbyRow.version,
        }
      : null;
  const named = namedPersonOf(command);
  const people = named === null ? [senderUserId] : [senderUserId, named];
  const account = named ? await loadAuthorizationAccount(tx, named) : null;
  return {
    now: input.now,
    senderUserId,
    newId: input.newId,
    organization,
    handleTaken:
      command.type === 'create-organization' &&
      (await handleTaken(tx, command.handle, input.newId)),
    ...(lobby
      ? {
          memberships: organization
            ? await loadMemberships(tx, organization.id, [...new Set(people)])
            : [],
          grants: await loadGrantRows(tx, {
            ...(organization
              ? { organizationId: organization.id, lobbyId: lobby.id }
              : { lobbyId: lobby.id }),
            userIds: [...new Set(people)],
            grantIds: command.type === 'remove-grant' ? [command.grantId] : [],
          }),
        }
      : await peopleRows(
          tx,
          scope,
          organization,
          [...new Set(people)],
          command,
        )),
    role: await roleNamedOf(tx, command),
    lobby,
    personAgeBand: account?.ageBand ?? null,
    staffMinimumBand: organization
      ? await loadStaffMinimumBand(tx, organization.id)
      : staffMinimumBandOf(null),
  };
};
