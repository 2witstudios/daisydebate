import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { Permission } from '@daisy/protocol/lobby';
import { daisyOrganizationId } from '../daisy-reference';
import { rolePermissions, roles } from '../schema/organizations';
import type { Tx } from '../tx';

/** A `roles` row with its `role_permissions`. Rank 1 is the highest. */
export type RoleRow = {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly rank: number;
  readonly preset: boolean;
  readonly permissions: readonly Permission[];
};

const withPermissions = async (
  tx: Tx,
  found: readonly Omit<RoleRow, 'permissions'>[],
): Promise<readonly RoleRow[]> => {
  if (found.length === 0) return [];
  const held = await tx
    .select({
      roleId: rolePermissions.roleId,
      permission: rolePermissions.permission,
    })
    .from(rolePermissions)
    .where(
      inArray(
        rolePermissions.roleId,
        found.map((role) => role.id),
      ),
    )
    .orderBy(asc(rolePermissions.permission));
  return found.map((role) => ({
    ...role,
    permissions: held
      .filter((row) => row.roleId === role.id)
      .map((row) => row.permission),
  }));
};

const columns = {
  id: roles.id,
  organizationId: roles.organizationId,
  name: roles.name,
  rank: roles.rank,
  preset: roles.preset,
};

/** The roles with these ids, with their permissions. */
export const loadRoles = async (
  tx: Tx,
  ids: readonly string[],
): Promise<readonly RoleRow[]> =>
  ids.length === 0
    ? []
    : withPermissions(
        tx,
        await tx
          .select(columns)
          .from(roles)
          .where(inArray(roles.id, [...ids])),
      );

/**
 * The roles an organization may give: Daisy's presets, offered to every
 * organization, and its own, highest first. A personal lobby has no owning
 * organization and receives only the shared presets.
 */
export const loadOfferedRoles = async (
  tx: Tx,
  organizationId: string | null,
): Promise<readonly RoleRow[]> =>
  withPermissions(
    tx,
    await tx
      .select(columns)
      .from(roles)
      .where(
        or(
          and(
            eq(roles.organizationId, daisyOrganizationId),
            eq(roles.preset, true),
          ),
          organizationId === null
            ? undefined
            : eq(roles.organizationId, organizationId),
        ),
      )
      .orderBy(asc(roles.rank), asc(roles.id)),
  );
