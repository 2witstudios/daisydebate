import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { GrantScopeKind } from '@daisy/protocol/lobby';
import { grants } from '../schema/grants';
import { lobbies } from '../schema/lobbies';
import { loadRoles, type RoleRow } from './role-rows';
import type { TabTransaction } from './tab-transaction';

/** A `grants` row with its role and explicit organization or lobby scope. */
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
  readonly role: RoleRow;
};

const iso = (at: Date | null): string | null =>
  at === null ? null : at.toISOString();

/**
 * The grants, revoked ones included, that these people hold at the named
 * organization and/or exact lobby, and a grant named within those scopes. The
 * tenant fence decides which rows the transaction can see: the
 * organization's own grants, the subject's, and its lobby's when one is set.
 * `loadOrganizationGrantRows` explicitly visits an organization's owned lobbies.
 */
export const loadGrantRows = async (
  tx: TabTransaction,
  input: {
    readonly userIds: readonly string[];
    readonly grantIds?: readonly string[];
  } & (
    | { readonly organizationId: string; readonly lobbyId?: string }
    | { readonly organizationId?: never; readonly lobbyId: string }
  ),
): Promise<readonly GrantRow[]> => {
  const target = or(
    input.organizationId
      ? eq(grants.organizationId, input.organizationId)
      : undefined,
    input.lobbyId ? eq(grants.lobbyId, input.lobbyId) : undefined,
  );
  const held = input.userIds.length
    ? inArray(grants.userId, [...input.userIds])
    : undefined;
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
    })
    .from(grants)
    .leftJoin(lobbies, eq(lobbies.id, grants.lobbyId))
    .where(and(target, or(held, named)))
    .orderBy(asc(grants.grantedAt), asc(grants.id));
  const roles = await loadRoles(tx, [
    ...new Set(rows.map((row) => row.roleId)),
  ]);
  return rows.flatMap((row) => {
    const role = roles.find((candidate) => candidate.id === row.roleId);
    if (role === undefined) return [];
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
        role,
      },
    ];
  });
};
