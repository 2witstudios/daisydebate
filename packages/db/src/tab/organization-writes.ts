import { createAppError } from '@daisy/errors';
import { postgresViolation } from '../postgres-violation';
import { bumpTabAccountRevision } from './command-accounts';
import { and, eq, isNull } from 'drizzle-orm';
import type {
  GrantScopeKind,
  MembershipStatus,
  OrganizationKind,
} from '@daisy/protocol/lobby';
import type { RatingDivision } from '@daisy/protocol';
import { grants } from '../schema/grants';
import { memberships, organizations } from '../schema/organizations';
import { lobbies } from '../schema/lobbies';
import type { TenantScope } from '../tenant-scope';
import {
  loadOrganizationGrantRows,
  underLobbyScope,
} from './organization-grant-rows';
import type { TabTransaction } from './tab-transaction';

/** The rows an accepted organization or grant command writes, as data. */
export type OrganizationWrite =
  | {
      readonly table: 'lobbies';
      readonly op: 'update';
      readonly id: string;
      readonly set: { readonly version: number };
    }
  | {
      readonly table: 'organizations';
      readonly op: 'insert';
      readonly row: {
        readonly id: string;
        readonly kind: OrganizationKind;
        readonly name: string;
        readonly handle: string;
        readonly ownerUserId: string | null;
        /** A league's division; null for every other kind. */
        readonly leagueDivision: RatingDivision | null;
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
  const lobbyId = scope.lobbyId ?? (await lobbyOfGrant(tx, scope, write.id));
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
    case 'lobbies':
      return exactlyOne(
        write,
        await tx
          .update(lobbies)
          .set(write.set)
          .where(
            and(
              eq(lobbies.id, write.id),
              eq(lobbies.version, write.set.version - 1),
            ),
          )
          .returning({ id: lobbies.id }),
      );
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
        try {
          await tx
            .insert(memberships)
            .values({ ...write.row, joinedAt: at(write.row.joinedAt) });
        } catch (error) {
          if (
            postgresViolation(error, '23503')?.constraint ===
            'memberships_user_id_users_id_fkey'
          )
            throw createAppError(
              'NOT_FOUND',
              'Membership recipient is missing',
              error,
            );
          throw error;
        }
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
      return bumpTabAccountRevision(tx, write.id);
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
