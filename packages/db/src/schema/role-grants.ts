import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { notBefore, oneOf, timestampColumn } from './columns';
import { users } from './users';

export const grantRoles = ['admin', 'moderator', 'judge'] as const;
/** Widened (tournament, league) by forward migration. */
export const grantScopeTypes = ['global'] as const;

/**
 * Authority attaches to the account, not the actor, so grants reference
 * `users`. Revocation keeps the row: the partial unique index allows one
 * active grant per (user, role, scope) and any number of revoked ones.
 * `@daisy/auth` principals derive from these rows later.
 */
export const roleGrants = pgTable(
  'role_grants',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: text('role').notNull(),
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id'),
    grantedByUserId: text('granted_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    grantedAt: timestampColumn('granted_at').notNull(),
    revokedAt: timestampColumn('revoked_at'),
  },
  (table) => [
    uniqueIndex('role_grants_active_unique')
      .on(
        table.userId,
        table.role,
        table.scopeType,
        sql`coalesce(${table.scopeId}, '')`,
      )
      .where(sql`${table.revokedAt} is null`),
    index('role_grants_user_idx').on(table.userId),
    index('role_grants_granted_by_user_idx').on(table.grantedByUserId),
    check('role_grants_role_check', oneOf(table.role, grantRoles)),
    check(
      'role_grants_scope_type_check',
      oneOf(table.scopeType, grantScopeTypes),
    ),
    check(
      'role_grants_global_scope_check',
      sql`${table.scopeType} <> 'global' or ${table.scopeId} is null`,
    ),
    check(
      'role_grants_revoked_after_granted',
      notBefore(table.revokedAt, table.grantedAt),
    ),
  ],
);
