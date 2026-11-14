import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import type { GrantScopeKind } from '@daisy/protocol/lobby';
import { grants } from '../schema/grants';
import { lobbies } from '../schema/lobbies';
import { loadRoles, type RoleRow } from './role-rows';
import type { TabTransaction } from './tab-transaction';

/** A `grants` row with its role, and the organization its scope belongs to. */
export type GrantRow = {
  readonly id: string;
  readonly userId: string;
  readonly scopeKind: GrantScopeKind;
  readonly organizationId: string | null;
  readonly lobbyId: string | null;
  /** The lobby's name, for a lobby-scope grant. */
  readonly lobbyName: string | null;
  readonly grantedAt: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  /** The organization itself, or the organization that owns the lobby. */
  readonly scopeOrganizationId: string;
  readonly role: RoleRow;
};

const iso = (at: Date | null): string | null =>
  at === null ? null : at.toISOString();

/**
 * The grants, revoked ones included, that these people hold in an
 * organization and the lobbies it owns, and any grant named by id. The
 * tenant fence decides which rows the transaction can see: the
 * organization's own grants, the subject's, and its lobby's when one is set.
 * `loadOrganizationGrantRows` visits every lobby's.
 */
export const loadGrantRows = async (
  tx: TabTransaction,
  input: {
    readonly organizationId: string;
    readonly userIds: readonly string[];
    readonly grantIds?: readonly string[];
  },
): Promise<readonly GrantRow[]> => {
  const scopeOrganizationId = sql<
    string | null
  >`coalesce(${grants.organizationId}, ${lobbies.ownerOrganizationId})`;
  const held = and(
    inArray(grants.userId, [...input.userIds]),
    or(
      eq(grants.organizationId, input.organizationId),
      eq(lobbies.ownerOrganizationId, input.organizationId),
    ),
  );
  const named =
    input.grantIds === undefined || input.grantIds.length === 0
      ? undefined
      : inArray(grants.id, [...input.grantIds]);
  if (input.userIds.length === 0 && named === undefined) return [];
  const rows = await tx
    .select({
      id: grants.id,
      userId: grants.userId,
      scopeKind: grants.scopeKind,
      organizationId: grants.organizationId,
      lobbyId: grants.lobbyId,
      lobbyName: lobbies.name,
      roleId: grants.roleId,
      grantedAt: grants.grantedAt,
      expiresAt: grants.expiresAt,
      revokedAt: grants.revokedAt,
      scopeOrganizationId,
    })
    .from(grants)
    .leftJoin(lobbies, eq(lobbies.id, grants.lobbyId))
    .where(input.userIds.length === 0 ? named : named ? or(held, named) : held)
    .orderBy(asc(grants.grantedAt), asc(grants.id));
  const roles = await loadRoles(tx, [
    ...new Set(rows.map((row) => row.roleId)),
  ]);
  return rows.flatMap((row) => {
    const role = roles.find((candidate) => candidate.id === row.roleId);
    // A grant of a lobby no organization owns belongs to no organization.
    if (role === undefined || row.scopeOrganizationId === null) return [];
    return [
      {
        id: row.id,
        userId: row.userId,
        scopeKind: row.scopeKind,
        organizationId: row.organizationId,
        lobbyId: row.lobbyId,
        lobbyName: row.lobbyName,
        grantedAt: row.grantedAt.toISOString(),
        expiresAt: iso(row.expiresAt),
        revokedAt: iso(row.revokedAt),
        scopeOrganizationId: row.scopeOrganizationId,
        role,
      },
    ];
  });
};
