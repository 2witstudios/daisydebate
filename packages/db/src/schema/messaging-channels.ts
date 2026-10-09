import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import {
  messagingActorColumn,
  messagingChannelColumn,
} from './messaging-columns';
import { createdAtColumn, oneOf } from './columns';

/** Social foundation only; contextual kinds arrive with their real producer. */
export const messagingChannels = pgTable(
  'messaging_channels',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    policyKey: text('policy_key').notNull(),
    policyRevision: integer('policy_revision').notNull(),
    lifecycle: text('lifecycle').notNull(),
    title: text('title'),
    messageSequence: bigint('message_sequence', { mode: 'number' })
      .notNull()
      .default(0),
    changeVersion: bigint('change_version', { mode: 'number' })
      .notNull()
      .default(0),
    authorityRevision: bigint('authority_revision', { mode: 'number' })
      .notNull()
      .default(1),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('messaging_channels_id_kind_unique').on(table.id, table.kind),
    check(
      'messaging_channels_kind',
      oneOf(table.kind, ['dm', 'private_group']),
    ),
    check(
      'messaging_channels_lifecycle',
      oneOf(table.lifecycle, ['active', 'archived']),
    ),
    check(
      'messaging_channels_policy',
      sql`${table.policyRevision} > 0 and ((${table.kind} = 'dm' and ${table.policyKey} = 'social.dm') or (${table.kind} = 'private_group' and ${table.policyKey} = 'social.private_group'))`,
    ),
    check(
      'messaging_channels_counters',
      sql`${table.messageSequence} between 0 and 9007199254740991 and ${table.changeVersion} between ${table.messageSequence} and 9007199254740991`,
    ),
    check(
      'messaging_channels_authority_revision',
      sql`${table.authorityRevision} between 1 and 9007199254740991`,
    ),
    check(
      'messaging_channels_title',
      sql`(${table.kind} = 'dm' and ${table.title} is null) or (${table.kind} = 'private_group' and ${table.title} is not null and ${table.title} ~ '[^[:space:]]')`,
    ),
  ],
);

/** Preferences are never access grants. Operations bound readSequence to history. */
export const messagingActorStates = pgTable(
  'messaging_actor_states',
  {
    channelId: messagingChannelColumn(() => messagingChannels.id),
    actorId: messagingActorColumn('actor_id'),
    following: boolean('following').notNull(),
    hidden: boolean('hidden').notNull(),
    notificationLevel: text('notification_level').notNull(),
    readSequence: bigint('read_sequence', { mode: 'number' })
      .notNull()
      .default(0),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.actorId] }),
    check(
      'messaging_actor_states_notification',
      oneOf(table.notificationLevel, ['all', 'mentions', 'none']),
    ),
    check(
      'messaging_actor_states_read',
      sql`${table.readSequence} between 0 and 9007199254740991`,
    ),
  ],
);
