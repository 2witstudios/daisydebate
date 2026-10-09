import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  unique,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  messagingActorColumn,
  messagingChannelColumn,
} from './messaging-columns';
import { timestampColumn } from './columns';
import { messagingChannels } from './messaging-channels';

/** Content is scrubbed in place; receipts never preserve deleted content. */
export const messagingMessages = pgTable(
  'messaging_messages',
  {
    id: text('id').primaryKey(),
    channelId: messagingChannelColumn(() => messagingChannels.id),
    authorActorId: messagingActorColumn('author_actor_id'),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    changeVersion: bigint('change_version', { mode: 'number' }).notNull(),
    text: text('text'),
    replyToMessageId: text('reply_to_message_id'),
    createdAt: timestampColumn('created_at').notNull(),
    editedAt: timestampColumn('edited_at'),
    removedAt: timestampColumn('removed_at'),
  },
  (table) => [
    unique('messaging_messages_id_channel_unique').on(
      table.id,
      table.channelId,
    ),
    unique('messaging_messages_sequence_unique').on(
      table.channelId,
      table.sequence,
    ),
    check(
      'messaging_messages_order',
      sql`${table.sequence} between 1 and 9007199254740991 and ${table.changeVersion} between ${table.sequence} and 9007199254740991`,
    ),
    check(
      'messaging_messages_content',
      sql`(${table.removedAt} is null and ${table.text} is not null and ${table.text} ~ '[^[:space:]]') or (${table.removedAt} is not null and ${table.text} is null)`,
    ),
    check(
      'messaging_messages_times',
      sql`(${table.editedAt} is null or ${table.editedAt} >= ${table.createdAt}) and (${table.removedAt} is null or ${table.removedAt} >= ${table.createdAt})`,
    ),
    foreignKey({
      name: 'messaging_messages_reply_channel_fk',
      columns: [table.replyToMessageId, table.channelId],
      foreignColumns: [table.id as AnyPgColumn, table.channelId as AnyPgColumn],
    }),
  ],
);

export const messagingReceipts = pgTable(
  'messaging_receipts',
  {
    channelId: messagingChannelColumn(() => messagingChannels.id),
    actorId: messagingActorColumn('actor_id'),
    requestId: text('request_id').notNull(),
    payloadDigest: text('payload_digest'),
    messageId: text('message_id'),
  },
  (table) => [
    primaryKey({ columns: [table.actorId, table.channelId, table.requestId] }),
    check(
      'messaging_receipts_digest',
      sql`${table.payloadDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    foreignKey({
      name: 'messaging_receipts_message_channel_fk',
      columns: [table.messageId, table.channelId],
      foreignColumns: [messagingMessages.id, messagingMessages.channelId],
    }),
  ],
);

export const messagingReactions = pgTable(
  'messaging_reactions',
  {
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').notNull(),
    actorId: messagingActorColumn('actor_id'),
    reaction: text('reaction').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.actorId, table.reaction] }),
    check(
      'messaging_reactions_nonempty',
      sql`${table.reaction} ~ '[^[:space:]]'`,
    ),
    foreignKey({
      name: 'messaging_reactions_message_channel_fk',
      columns: [table.messageId, table.channelId],
      foreignColumns: [messagingMessages.id, messagingMessages.channelId],
    }).onDelete('cascade'),
  ],
);
