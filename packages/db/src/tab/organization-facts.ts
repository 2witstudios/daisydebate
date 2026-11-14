import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { MembershipStatus, OrganizationKind } from '@daisy/protocol/lobby';
import type { OrganizationCommand } from '@daisy/protocol/lobby/organization-command';
import { loadAuthorizationAccount } from '../authorization';
import { lobbies } from '../schema/lobbies';
import { memberships, organizations } from '../schema/organizations';
import { settings } from '../schema/settings';
import { loadGrantRows, type GrantRow } from './grant-rows';
import { loadRoles, type RoleRow } from './role-rows';
import {
  staffMinimumBandOf,
  type StaffMinimumBand,
} from './staff-minimum-band';
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
  readonly lobbyOwnerOrganizationId: string | null;
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

/** The organization a command acts on: the one it names, or the one it creates. */
export const organizationIdOf = (input: {
  readonly command: OrganizationCommand;
  readonly newId: string;
}): string =>
  input.command.type === 'create-organization'
    ? input.newId
    : input.command.organizationId;

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
): Promise<OrganizationRow | null> => {
  const [row] = await tx
    .select(organizationColumns)
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .for('update');
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

const lobbyOwnerOf = async (
  tx: TabTransaction,
  command: OrganizationCommand,
): Promise<string | null> => {
  if (command.type !== 'give-grant' || command.scope.kind !== 'lobby')
    return null;
  const [row] = await tx
    .select({ ownerOrganizationId: lobbies.ownerOrganizationId })
    .from(lobbies)
    .where(eq(lobbies.id, command.scope.lobbyId));
  return row?.ownerOrganizationId ?? null;
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
  organization: OrganizationRow | null,
  people: readonly string[],
  command: OrganizationCommand,
) =>
  organization === null
    ? { memberships: [], grants: [] }
    : {
        memberships: await loadMemberships(tx, organization.id, people),
        grants: await loadGrantRows(tx, {
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
 * transaction the fence already scoped, with the organization's row locked.
 */
export const loadOrganizationFacts = async (
  tx: TabTransaction,
  input: OrganizationCommandInput,
): Promise<OrganizationCommandFacts> => {
  const { command, senderUserId } = input;
  const organizationId = organizationIdOf(input);
  const organization =
    command.type === 'create-organization'
      ? null
      : await lockOrganization(tx, organizationId);
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
      (await handleTaken(tx, command.handle, organizationId)),
    ...(await peopleRows(tx, organization, [...new Set(people)], command)),
    role: await roleNamedOf(tx, command),
    lobbyOwnerOrganizationId: await lobbyOwnerOf(tx, command),
    personAgeBand: account?.ageBand ?? null,
    staffMinimumBand: await loadStaffMinimumBand(tx, organizationId),
  };
};
