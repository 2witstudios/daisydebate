import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  messagingActorColumn,
  messagingChannelColumn,
} from './messaging-columns';
import { createdAtColumn, oneOf } from './columns';
import { actors } from './actors';
import { rounds } from './rounds';
import { messagingChannelLifecycles } from '@daisy/protocol';

/**
 * Social channels and separate Round floor/spectator conversations. Each
 * contextual kind is constrained to its exact Round and its own policy.
 */
export const messagingChannels = pgTable(
  'messaging_channels',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    policyKey: text('policy_key').notNull(),
    policyRevision: integer('policy_revision').notNull(),
    lifecycle: text('lifecycle').notNull(),
    /** The exact Round of a floor or spectator conversation; social kinds have none. */
    roundId: text('round_id').references(() => rounds.id, {
      onDelete: 'cascade',
    }),
    title: text('title'),
    titleAuthorActorId: text('title_author_actor_id').references(
      () => actors.id,
      { onDelete: 'restrict' },
    ),
    authorityRevision: bigint('authority_revision', { mode: 'number' })
      .notNull()
      .default(1),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('messaging_channels_title_author_idx').on(table.titleAuthorActorId),
    unique('messaging_channels_id_kind_unique').on(table.id, table.kind),
    uniqueIndex('messaging_channels_round_kind_unique').on(
      table.roundId,
      table.kind,
    ),
    check(
      'messaging_channels_kind',
      oneOf(table.kind, [
        'dm',
        'private_group',
        'round_floor',
        'round_spectator',
      ]),
    ),
    check(
      'messaging_channels_round',
      sql`(${table.kind} in ('round_floor', 'round_spectator')) = (${table.roundId} is not null)`,
    ),
    check(
      'messaging_channels_lifecycle',
      oneOf(table.lifecycle, messagingChannelLifecycles),
    ),
    check(
      'messaging_channels_policy',
      sql`${table.policyRevision} > 0 and ((${table.kind} = 'dm' and ${table.policyKey} = 'social.dm') or (${table.kind} = 'private_group' and ${table.policyKey} = 'social.private_group') or (${table.kind} = 'round_floor' and ${table.policyKey} = 'round.floor') or (${table.kind} = 'round_spectator' and ${table.policyKey} = 'round.spectator'))`,
    ),
    check(
      'messaging_channels_authority_revision',
      sql`${table.authorityRevision} between 1 and 9007199254740991`,
    ),
    check(
      'messaging_channels_title',
      sql`(${table.title} is null and ${table.titleAuthorActorId} is null) or (${table.kind} = 'private_group' and ${table.title} is not null and ${table.title} ~ '[^[:space:]]' and ${table.titleAuthorActorId} is not null)`,
    ),
  ],
);

/**
 * The channel stream (MSG-2.2-arch1): the ordered append header, apart from
 * the channel's authority. Only `messaging/stream.ts` writes these counters.
 */
export const messagingChannelStreams = pgTable(
  'messaging_channel_streams',
  {
    channelId: text('channel_id')
      .primaryKey()
      .references(() => messagingChannels.id, { onDelete: 'cascade' }),
    messageSequence: bigint('message_sequence', { mode: 'number' })
      .notNull()
      .default(0),
    changeVersion: bigint('change_version', { mode: 'number' })
      .notNull()
      .default(0),
  },
  (table) => [
    check(
      'messaging_channel_streams_counters',
      sql`${table.messageSequence} between 0 and 9007199254740991 and ${table.changeVersion} between ${table.messageSequence} and 9007199254740991`,
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
    index('messaging_actor_states_actor_idx').on(table.actorId),
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
