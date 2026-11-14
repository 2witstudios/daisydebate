import { commandAuthorities, grantScopeKinds } from '@daisy/protocol/lobby';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { oneOf, jsonbIsObject, timestampColumn } from './columns';
import { acceptedCommandColumns } from './command-columns';
import { conflicts } from './conflicts';
import { lobbies } from './lobbies';
import { memberships, organizations, roles } from './organizations';
import { digestCheck, nonEmpty, oneTenantKey } from './tenant-keys';
import { users } from './users';

/**
 * A role given to a person at exactly one scope, an organization or a
 * lobby, by someone (or by the operator), with an optional expiry. A lobby-scope grant is the
 * same row whether the lobby is a tournament (tab staff) or standing (a
 * league's moderators). An organization-scope grant needs a membership row.
 * A grant is revoked, never deleted or otherwise changed, by trigger, so
 * action history that names it always resolves.
 */
export const grants = pgTable(
  'grants',
  {
    id: text('id').primaryKey(),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    scopeKind: text('scope_kind')
      .$type<(typeof grantScopeKinds)[number]>()
      .notNull(),
    organizationId: text('organization_id'),
    lobbyId: text('lobby_id').references(() => lobbies.id, {
      onDelete: 'restrict',
    }),
    /**
     * Who gave it. Null only for a grant given from outside the product:
     * Daisy's own organization has no owner row (ADR 0043), so its first
     * grant is the operator's and names no person.
     */
    grantedByUserId: text('granted_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    grantedAt: timestampColumn('granted_at').notNull(),
    expiresAt: timestampColumn('expires_at'),
    revokedAt: timestampColumn('revoked_at'),
    revokedByUserId: text('revoked_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
  },
  (table) => [
    uniqueIndex('grants_live_unique')
      .on(
        table.userId,
        table.roleId,
        sql`coalesce(${table.organizationId}, ${table.lobbyId})`,
      )
      .where(sql`${table.revokedAt} is null`),
    index('grants_role_idx').on(table.roleId),
    index('grants_user_idx').on(table.userId),
    index('grants_membership_idx').on(table.organizationId, table.userId),
    index('grants_lobby_idx').on(table.lobbyId),
    index('grants_granted_by_user_idx').on(table.grantedByUserId),
    index('grants_revoked_by_user_idx').on(table.revokedByUserId),
    foreignKey({
      name: 'grants_membership_fk',
      columns: [table.organizationId, table.userId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }).onDelete('restrict'),
    check('grants_scope_kind_check', oneOf(table.scopeKind, grantScopeKinds)),
    check(
      'grants_scope_check',
      sql`(${table.scopeKind} = 'organization' and ${table.organizationId} is not null and ${table.lobbyId} is null)
        or (${table.scopeKind} = 'lobby' and ${table.lobbyId} is not null and ${table.organizationId} is null)`,
    ),
    oneTenantKey('grants', table.organizationId, table.lobbyId),
    check(
      'grants_expires_after_granted',
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.grantedAt}`,
    ),
    check(
      'grants_revocation_check',
      sql`(${table.revokedAt} is null) = (${table.revokedByUserId} is null) and (${table.revokedAt} is null or ${table.revokedAt} >= ${table.grantedAt})`,
    ),
  ],
);

/**
 * The action history: the record of every command, attributed to who ran
 * it, under which authority, on what, when. Exactly one of the two
 * isolation keys and exactly one principal. Append-only: the runtime role
 * holds no UPDATE or DELETE and a trigger refuses both for every role.
 */
export const actionHistory = pgTable(
  'action_history',
  {
    commandId: text('command_id').primaryKey(),
    organizationId: text('organization_id').references(() => organizations.id, {
      onDelete: 'restrict',
    }),
    lobbyId: text('lobby_id').references(() => lobbies.id, {
      onDelete: 'restrict',
    }),
    actorUserId: text('actor_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    serviceId: text('service_id'),
    authority: text('authority')
      .$type<(typeof commandAuthorities)[number]>()
      .notNull(),
    grantId: text('grant_id').references(() => grants.id, {
      onDelete: 'restrict',
    }),
    /** The relationship the evaluator allowed under, when authority is one. */
    relation: text('relation'),
    aggregateKind: text('aggregate_kind').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    conflictId: text('conflict_id'),
    ...acceptedCommandColumns(),
  },
  (table) => [
    unique('action_history_command_lobby_unique').on(
      table.commandId,
      table.lobbyId,
    ),
    index('action_history_organization_idx').on(
      table.organizationId,
      table.appliedAt,
    ),
    index('action_history_lobby_idx').on(table.lobbyId, table.appliedAt),
    index('action_history_actor_user_idx').on(table.actorUserId),
    index('action_history_grant_idx').on(table.grantId),
    index('action_history_conflict_idx').on(table.conflictId, table.lobbyId),
    index('action_history_aggregate_idx').on(
      table.aggregateKind,
      table.aggregateId,
    ),
    foreignKey({
      name: 'action_history_conflict_fk',
      columns: [table.conflictId, table.lobbyId],
      foreignColumns: [conflicts.id, conflicts.lobbyId],
    }).onDelete('restrict'),
    oneTenantKey('action_history', table.organizationId, table.lobbyId),
    check(
      'action_history_one_principal',
      sql`(${table.actorUserId} is null) <> (${table.serviceId} is null)`,
    ),
    check(
      'action_history_authority_check',
      oneOf(table.authority, commandAuthorities),
    ),
    check(
      'action_history_service_authority',
      sql`(${table.authority} = 'service') = (${table.serviceId} is not null)`,
    ),
    check(
      'action_history_grant_authority',
      sql`(${table.authority} = 'grant') = (${table.grantId} is not null)`,
    ),
    check(
      'action_history_relationship_authority',
      sql`(${table.authority} = 'relationship') = (${table.relation} is not null)`,
    ),
    check(
      'action_history_conflict_in_lobby',
      sql`${table.conflictId} is null or ${table.lobbyId} is not null`,
    ),
    nonEmpty('action_history_aggregate_kind_nonempty', table.aggregateKind),
    nonEmpty('action_history_aggregate_id_nonempty', table.aggregateId),
    digestCheck('action_history_digest_check', table.payloadDigest),
    jsonbIsObject('action_history', table.result),
  ],
);
