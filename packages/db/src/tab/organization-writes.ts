import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  GrantScopeKind,
  MembershipStatus,
  OrganizationKind,
} from '@daisy/protocol/lobby';
import { grants } from '../schema/grants';
import { memberships, organizations } from '../schema/organizations';
import { users } from '../schema/users';
import type { TenantScope } from '../tenant-scope';
import {
  loadOrganizationGrantRows,
  underLobbyScope,
} from './organization-grant-rows';
import type { TabTransaction } from './tab-transaction';

/** The rows an accepted organization or grant command writes, as data. */
export type OrganizationWrite =
  | {
      readonly table: 'organizations';
      readonly op: 'insert';
      readonly row: {
        readonly id: string;
        readonly kind: OrganizationKind;
        readonly name: string;
        readonly handle: string;
        readonly ownerUserId: string | null;
      };
    }
  | {
      readonly table: 'organizations';
      readonly op: 'update';
      readonly id: string;
      readonly set: {
        readonly name?: string;
        readonly ownerUserId?: string;
        readonly version: number;
      };
    }
  | {
      readonly table: 'memberships';
      readonly op: 'insert';
      readonly row: {
        readonly organizationId: string;
        readonly userId: string;
        readonly status: 'invited' | 'active';
        readonly joinedAt: string | null;
      };
    }
  | {
      readonly table: 'memberships';
      readonly op: 'update';
      readonly key: {
        readonly organizationId: string;
        readonly userId: string;
      };
      readonly set: {
        readonly status: MembershipStatus;
        readonly joinedAt?: string | null;
        readonly endedAt: string | null;
        readonly version: number;
      };
    }
  | {
      readonly table: 'grants';
      readonly op: 'insert';
      readonly row: {
        readonly id: string;
        readonly roleId: string;
        readonly userId: string;
        readonly scopeKind: GrantScopeKind;
        readonly organizationId: string | null;
        readonly lobbyId: string | null;
        readonly grantedByUserId: string;
        readonly grantedAt: string;
        readonly expiresAt: string | null;
      };
    }
  | {
      readonly table: 'grants';
      readonly op: 'update';
      readonly id: string;
      readonly set: {
        readonly revokedAt: string;
        readonly revokedByUserId: string;
      };
    }
  | {
      readonly table: 'users';
      readonly op: 'update';
      readonly id: string;
      readonly increment: 'version';
    };

const at = (instant: string | null): Date | null =>
  instant === null ? null : new Date(instant);

/** An update the decision counted on that changed no row: the facts were not what was decided on. */
class UnappliedWrite extends Error {
  constructor(write: OrganizationWrite) {
    super(`${write.table} ${write.op} changed no row`);
  }
}

const exactlyOne = (
  write: OrganizationWrite,
  changed: readonly unknown[],
): void => {
  if (changed.length !== 1) throw new UnappliedWrite(write);
};

/** The lobby of a grant at one of the organization's lobbies, or null. */
const lobbyOfGrant = async (
  tx: TabTransaction,
  scope: TenantScope,
  grantId: string,
): Promise<string | null> => {
  if (scope.organizationId === undefined) return null;
  const [grant] = await loadOrganizationGrantRows(tx, scope, {
    organizationId: scope.organizationId,
    userIds: [],
    grantIds: [grantId],
  });
  return grant?.lobbyId ?? null;
};

/** Revokes a grant, under its lobby's scope when it is a lobby grant. */
const revokeGrant = async (
  tx: TabTransaction,
  write: Extract<OrganizationWrite, { table: 'grants'; op: 'update' }>,
  scope: TenantScope,
): Promise<void> => {
  const revoke = async () =>
    exactlyOne(
      write,
      await tx
        .update(grants)
        .set({
          revokedAt: new Date(write.set.revokedAt),
          revokedByUserId: write.set.revokedByUserId,
        })
        .where(and(eq(grants.id, write.id), isNull(grants.revokedAt)))
        .returning({ id: grants.id }),
    );
  const lobbyId = await lobbyOfGrant(tx, scope, write.id);
  return lobbyId === null
    ? revoke()
    : underLobbyScope(tx, scope, lobbyId, revoke);
};

const applyOne = async (
  tx: TabTransaction,
  write: OrganizationWrite,
  scope: TenantScope,
): Promise<void> => {
  switch (write.table) {
    case 'organizations':
      if (write.op === 'insert') {
        await tx.insert(organizations).values(write.row);
        return;
      }
      return exactlyOne(
        write,
        await tx
          .update(organizations)
          .set(write.set)
          .where(
            and(
              eq(organizations.id, write.id),
              eq(organizations.version, write.set.version - 1),
            ),
          )
          .returning({ id: organizations.id }),
      );
    case 'memberships':
      if (write.op === 'insert') {
        await tx
          .insert(memberships)
          .values({ ...write.row, joinedAt: at(write.row.joinedAt) });
        return;
      }
      return exactlyOne(
        write,
        await tx
          .update(memberships)
          .set({
            status: write.set.status,
            endedAt: at(write.set.endedAt),
            version: write.set.version,
            ...(write.set.joinedAt === undefined
              ? {}
              : { joinedAt: at(write.set.joinedAt) }),
          })
          .where(
            and(
              eq(memberships.organizationId, write.key.organizationId),
              eq(memberships.userId, write.key.userId),
              eq(memberships.version, write.set.version - 1),
            ),
          )
          .returning({ userId: memberships.userId }),
      );
    case 'grants':
      if (write.op === 'insert') {
        await tx.insert(grants).values({
          ...write.row,
          grantedAt: new Date(write.row.grantedAt),
          expiresAt: at(write.row.expiresAt),
        });
        return;
      }
      return revokeGrant(tx, write, scope);
    case 'users':
      return exactlyOne(
        write,
        await tx
          .update(users)
          .set({ version: sql`${users.version} + 1` })
          .where(eq(users.id, write.id))
          .returning({ id: users.id }),
      );
  }
};

/**
 * Applies an accepted command's writes in order, in the transaction the
 * fence scoped to `scope`. An update that changes no row throws, so the
 * transaction ends without the command.
 */
export const applyOrganizationWrites = async (
  tx: TabTransaction,
  writes: readonly OrganizationWrite[],
  scope: TenantScope,
): Promise<void> => {
  for (const write of writes) await applyOne(tx, write, scope);
};
