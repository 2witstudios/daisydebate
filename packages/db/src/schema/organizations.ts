import {
  membershipStatuses,
  organizationKinds,
  permissions,
} from '@daisy/protocol/lobby';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { daisyOrganizationId } from '../daisy-reference';
import {
  createdAtColumn,
  oneOf,
  timestampColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { nonEmpty } from './tenant-keys';
import { users } from './users';

/**
 * A league, or a school or club. Daisy is organization number one. The Owner
 * is a fixed position, not a role, so "an organization always keeps an owner"
 * is this column: every organization has one except Daisy itself, whose owner
 * is the operator, outside the participant database (ADR 0043).
 * `settings_version` is the optimistic counter of this scope's settings,
 * which moves apart from `version`.
 */
export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<(typeof organizationKinds)[number]>().notNull(),
    name: text('name').notNull(),
    handle: text('handle').notNull(),
    ownerUserId: text('owner_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    /** Reserved for hosting fees; nothing reads it. */
    billingOwnerUserId: text('billing_owner_user_id').references(
      () => users.id,
      { onDelete: 'restrict' },
    ),
    closedAt: timestampColumn('closed_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
    settingsVersion: integer('settings_version').notNull().default(1),
  },
  (table) => [
    unique('organizations_id_kind_unique').on(table.id, table.kind),
    uniqueIndex('organizations_handle_unique').on(sql`lower(${table.handle})`),
    index('organizations_owner_user_idx').on(table.ownerUserId),
    index('organizations_billing_owner_user_idx').on(table.billingOwnerUserId),
    check('organizations_kind_check', oneOf(table.kind, organizationKinds)),
    check(
      'organizations_has_owner',
      sql`${table.ownerUserId} is not null or ${table.id} = '${sql.raw(daisyOrganizationId)}'`,
    ),
    nonEmpty('organizations_name_nonempty', table.name),
    nonEmpty('organizations_handle_nonempty', table.handle),
    versionPositive('organizations', table.version),
    versionPositive('organizations_settings', table.settingsVersion),
  ],
);

/**
 * A person belongs to an organization. One row per pair; rejoining reopens
 * it. It carries no role and no permission: authority comes only from a
 * grant, and only an `active` membership lets a grant count.
 */
export const memberships = pgTable(
  'memberships',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: text('status')
      .$type<(typeof membershipStatuses)[number]>()
      .notNull(),
    joinedAt: timestampColumn('joined_at'),
    endedAt: timestampColumn('ended_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    index('memberships_user_idx').on(table.userId),
    check('memberships_status_check', oneOf(table.status, membershipStatuses)),
    check(
      'memberships_joined_once_accepted',
      sql`(${table.status} in ('active', 'ended')) = (${table.joinedAt} is not null)`,
    ),
    check(
      'memberships_ended_consistent',
      sql`(${table.status} = 'ended') = (${table.endedAt} is not null)`,
    ),
    versionPositive('memberships', table.version),
  ],
);

/**
 * A named set of permissions. `rank` orders an organization's roles, 1 the
 * highest: a person gives or removes only roles ranked below their own
 * highest. `preset` marks Daisy's own rows, which every organization and
 * host may give; no command creates or edits a role yet.
 */
export const roles = pgTable(
  'roles',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    rank: integer('rank').notNull(),
    preset: boolean('preset').notNull().default(false),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    unique('roles_id_organization_unique').on(table.id, table.organizationId),
    unique('roles_rank_unique').on(table.organizationId, table.rank),
    uniqueIndex('roles_name_unique').on(
      table.organizationId,
      sql`lower(${table.name})`,
    ),
    check('roles_rank_positive', sql`${table.rank} > 0`),
    check(
      'roles_preset_is_daisy',
      sql`not ${table.preset} or ${table.organizationId} = '${sql.raw(daisyOrganizationId)}'`,
    ),
    nonEmpty('roles_name_nonempty', table.name),
    versionPositive('roles', table.version),
  ],
);

/** One permission a role holds. */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: text('role_id').notNull(),
    organizationId: text('organization_id').notNull(),
    permission: text('permission')
      .$type<(typeof permissions)[number]>()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permission] }),
    index('role_permissions_role_idx').on(table.roleId, table.organizationId),
    foreignKey({
      name: 'role_permissions_role_fk',
      columns: [table.roleId, table.organizationId],
      foreignColumns: [roles.id, roles.organizationId],
    }).onDelete('cascade'),
    check(
      'role_permissions_permission_check',
      oneOf(table.permission, permissions),
    ),
  ],
);
