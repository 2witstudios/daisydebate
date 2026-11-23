import { listedWord, listedWords } from './lifecycle-sql';
import { membershipStatuses } from '@daisy/protocol/lobby';
import { createAppError } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows, query } from './raw-rows';
import { scopeTransaction } from './tenant-scope';
import { z } from 'zod';

/**
 * A row this step just read under the subject scope must be writable under
 * its own scope; one that is not would leave authority in place silently.
 */
const reached = (result: unknown, what: string) => {
  if ((result as unknown[]).length === 0)
    throw createAppError(
      'INVARIANT',
      `Erasure could not end a ${what} it had read`,
    );
};

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
    const memberships = await query(
      tx,
      z.object({ organization_id: z.string() }),
      sql`select organization_id from memberships
        where user_id = ${subject.userId} and status in ${listedWords(membershipStatuses, ['invited', 'active'])}`,
    );
    const grants = await query(
      tx,
      z.object({
        id: z.string(),
        organization_id: z.string().nullable(),
        lobby_id: z.string().nullable(),
      }),
      sql`select id, organization_id, lobby_id from grants
        where user_id = ${subject.userId} and revoked_at is null`,
    );
    for (const grant of grants) {
      await scopeTransaction(tx, {
        organizationId: grant.organization_id ?? undefined,
        lobbyId: grant.lobby_id ?? undefined,
      });
      reached(
        await query(
          tx,
          z.object({ id: z.string() }),
          sql`update grants set revoked_at = greatest(${now}::timestamptz, granted_at),
              revoked_by_user_id = ${subject.userId}
            where id = ${grant.id} and revoked_at is null returning id`,
        ),
        'grant',
      );
    }
    for (const { organization_id: organizationId } of memberships) {
      await scopeTransaction(tx, { organizationId });
      reached(
        await query(
          tx,
          z.object({ user_id: z.string() }),
          sql`update memberships set
            status = case when status = ${listedWord(membershipStatuses, 'active')} then 'ended' else 'declined' end,
            ended_at = case when status = ${listedWord(membershipStatuses, 'active')} then ${now}::timestamptz end,
            updated_at = ${now}::timestamptz, version = version + 1
          where organization_id = ${organizationId} and user_id = ${subject.userId}
            and status in ${listedWords(membershipStatuses, ['invited', 'active'])} returning user_id`,
        ),
        'membership',
      );
    }
    await scopeTransaction(tx, {});
  },
  export: async (tx, subject) => {
    await scopeTransaction(tx, { subjectUserId: subject.userId });
    const result = {
      memberships: exportRows(
        await query(
          tx,
          z.object({
            organization_id: z.string(),
            status: z.enum(membershipStatuses),
            joined_at: z.date().nullable(),
            ended_at: z.date().nullable(),
          }),
          sql`select organization_id, status, joined_at, ended_at from memberships
            where user_id = ${subject.userId} order by organization_id`,
        ),
      ),
      membershipPeriods: exportRows(
        await query(
          tx,
          z.object({
            organization_id: z.string(),
            joined_at: z.date(),
            ended_at: z.date().nullable(),
          }),
          sql`select organization_id, joined_at, ended_at from membership_periods
            where user_id = ${subject.userId} order by organization_id, joined_at`,
        ),
      ),
      grants: exportRows(
        await query(
          tx,
          z.object({
            id: z.string(),
            role_id: z.string(),
            scope_kind: z.string(),
            organization_id: z.string().nullable(),
            lobby_id: z.string().nullable(),
            granted_at: z.date(),
            expires_at: z.date().nullable(),
            revoked_at: z.date().nullable(),
          }),
          sql`select id, role_id, scope_kind, organization_id, lobby_id,
              granted_at, expires_at, revoked_at
            from grants where user_id = ${subject.userId} order by granted_at, id`,
        ),
      ),
    };
    await scopeTransaction(tx, {});
    return result;
  },
};
