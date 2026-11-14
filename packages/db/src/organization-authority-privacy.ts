import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';
import { scopeTransaction } from './tenant-scope';

type Rows = Record<string, unknown>[];

/**
 * Organization membership and authority (docs/operations/compliance.md).
 * Export returns the member's own memberships and grants, read under the
 * subject scope. Erasure ends every membership and revokes every live
 * grant, each under the scope of the organization or lobby that holds it,
 * so a closed account holds no authority anywhere. The rows stay: a grant
 * is never deleted, and action history that names it is part of the record.
 * An organization or a tournament lobby the member owns keeps naming their
 * closed account; what happens to it is an open owner decision.
 */
export const organizationAuthorityPrivacyAdopter: PrivacyAdopter = {
  id: 'organization-authority',
  phase: 'after-close',
  erase: async (tx, subject, { now }) => {
    await scopeTransaction(tx, { subjectUserId: subject.userId });
    const memberships = (await tx.execute(
      sql`select organization_id from memberships
        where user_id = ${subject.userId} and status in ('invited', 'active')`,
    )) as unknown as Array<{ organization_id: string }>;
    const grants = (await tx.execute(
      sql`select id, organization_id, lobby_id from grants
        where user_id = ${subject.userId} and revoked_at is null`,
    )) as unknown as Array<{
      id: string;
      organization_id: string | null;
      lobby_id: string | null;
    }>;
    for (const grant of grants) {
      await scopeTransaction(tx, {
        organizationId: grant.organization_id ?? undefined,
        lobbyId: grant.lobby_id ?? undefined,
      });
      await tx.execute(
        sql`update grants set revoked_at = greatest(${now}::timestamptz, granted_at),
            revoked_by_user_id = ${subject.userId}
          where id = ${grant.id} and revoked_at is null`,
      );
    }
    for (const { organization_id: organizationId } of memberships) {
      await scopeTransaction(tx, { organizationId });
      await tx.execute(
        sql`update memberships set
            status = case when status = 'active' then 'ended' else 'declined' end,
            ended_at = case when status = 'active' then ${now}::timestamptz end,
            updated_at = ${now}::timestamptz, version = version + 1
          where organization_id = ${organizationId} and user_id = ${subject.userId}
            and status in ('invited', 'active')`,
      );
    }
    await scopeTransaction(tx, {});
  },
  export: async (tx, subject) => {
    await scopeTransaction(tx, { subjectUserId: subject.userId });
    const result = {
      memberships: exportRows(
        (await tx.execute(
          sql`select organization_id, status, joined_at, ended_at from memberships
            where user_id = ${subject.userId} order by organization_id`,
        )) as unknown as Rows,
      ),
      grants: exportRows(
        (await tx.execute(
          sql`select id, role_id, scope_kind, organization_id, lobby_id,
              granted_at, expires_at, revoked_at
            from grants where user_id = ${subject.userId} order by granted_at, id`,
        )) as unknown as Rows,
      ),
    };
    await scopeTransaction(tx, {});
    return result;
  },
};
