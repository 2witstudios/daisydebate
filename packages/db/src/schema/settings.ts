import {
  settingHolds,
  settingKeys,
  settingScopeKinds,
} from '@daisy/protocol/setting-keys';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  jsonbColumn,
  jsonbIsObject,
  jsonObjectSchema,
  oneOf,
  updatedAtColumn,
} from './columns';
import { events } from './events';
import { lobbies } from './lobbies';
import { organizations } from './organizations';
import { templates } from './templates';
import { oneTenantKey } from './tenant-keys';

/**
 * Every configurable value: one catalogue key, one JSON-object value, at one
 * scope, with a hold. The database proves the scope, the scope's isolation
 * key, the key and one row per scope and key; the value is opaque to it and
 * is parsed against its key's schema by the protocol catalogue. A row has no
 * version: clearing a setting deletes its row, so the optimistic counter is
 * `settings_version` on the scope's own row. A Room has no rows here.
 */
export const settings = pgTable(
  'settings',
  {
    id: text('id').primaryKey(),
    scopeKind: text('scope_kind')
      .$type<(typeof settingScopeKinds)[number]>()
      .notNull(),
    organizationId: text('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    templateId: text('template_id'),
    lobbyId: text('lobby_id').references(() => lobbies.id, {
      onDelete: 'cascade',
    }),
    eventId: text('event_id'),
    key: text('key').$type<(typeof settingKeys)[number]>().notNull(),
    hold: text('hold').$type<(typeof settingHolds)[number]>().notNull(),
    /** Its contract is the catalogue's schema for `key`, which slice E owns. */
    value: jsonbColumn('value', jsonObjectSchema).notNull(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('settings_organization_key_unique')
      .on(table.organizationId, table.key)
      .where(sql`${table.scopeKind} = 'organization'`),
    uniqueIndex('settings_template_key_unique')
      .on(table.templateId, table.key)
      .where(sql`${table.scopeKind} = 'template'`),
    uniqueIndex('settings_lobby_key_unique')
      .on(table.lobbyId, table.key)
      .where(sql`${table.scopeKind} = 'lobby'`),
    uniqueIndex('settings_event_key_unique')
      .on(table.eventId, table.key)
      .where(sql`${table.scopeKind} = 'event'`),
    index('settings_organization_idx').on(table.organizationId),
    index('settings_lobby_idx').on(table.lobbyId),
    index('settings_template_idx').on(table.templateId, table.organizationId),
    index('settings_event_idx').on(table.eventId, table.lobbyId),
    foreignKey({
      name: 'settings_template_fk',
      columns: [table.templateId, table.organizationId],
      foreignColumns: [templates.id, templates.organizationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'settings_event_fk',
      columns: [table.eventId, table.lobbyId],
      foreignColumns: [events.id, events.lobbyId],
    }).onDelete('cascade'),
    check(
      'settings_scope_kind_check',
      oneOf(table.scopeKind, settingScopeKinds),
    ),
    // One scope, carrying that scope's own isolation key.
    check(
      'settings_scope_check',
      sql`(${table.scopeKind} = 'organization' and ${table.organizationId} is not null and ${table.templateId} is null and ${table.lobbyId} is null and ${table.eventId} is null)
        or (${table.scopeKind} = 'template' and ${table.templateId} is not null and ${table.organizationId} is not null and ${table.lobbyId} is null and ${table.eventId} is null)
        or (${table.scopeKind} = 'lobby' and ${table.lobbyId} is not null and ${table.organizationId} is null and ${table.templateId} is null and ${table.eventId} is null)
        or (${table.scopeKind} = 'event' and ${table.eventId} is not null and ${table.lobbyId} is not null and ${table.organizationId} is null and ${table.templateId} is null)`,
    ),
    oneTenantKey('settings', table.organizationId, table.lobbyId),
    check('settings_key_check', oneOf(table.key, settingKeys)),
    check('settings_hold_check', oneOf(table.hold, settingHolds)),
    check(
      'settings_event_hold_is_default',
      sql`${table.scopeKind} <> 'event' or ${table.hold} = 'default'`,
    ),
    jsonbIsObject('settings', table.value),
  ],
);
